import { isTauri } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { createBrowserAdapter } from '@/storage/browserAdapter'
import {
  forgetHandle,
  FsaAdapter,
  hasPermission,
  loadSavedHandle,
  pickFolder,
  requestPermission,
  saveHandle,
} from '@/storage/fsaAdapter'
import { checkRemote, forgetRemoteConfig, loadRemoteConfig, saveRemoteConfig } from '@/storage/remoteAdapter'
import type { RemoteConfig } from '@/storage/remoteLink'
import { resetSyncState, SyncedAdapter } from '@/storage/syncedAdapter'
import { forgetPath, loadSavedPath, pickFolderPath, savePath, TauriAdapter } from '@/storage/tauriAdapter'
import { dirname, type VaultAdapter } from '@/storage/VaultAdapter'
import type { Board, Note, Pin, SubjectColor, SubjectIcon, Subject, Tool, ToolIcon } from '@/types'
import { extractExcerpt, extractTitle, sameBody } from './format'
import { imagesByName, isMarkdownFile } from '@/lib/files'
import * as repo from './repo'
import { emptyMap, mapText, type NoteMap } from '@/editor/map/types'
import { mergeBoards, parseBoard, serializeBoard, type BoardData } from '@/features/boards/model'

type Status = 'loading' | 'ready' | 'needs-permission' | 'error'
type SubjectInput = { name: string; color: SubjectColor; icon: SubjectIcon }

type Undo = () => Promise<void>

interface VaultState extends repo.VaultData {
  status: Status
  error?: string
  adapter: VaultAdapter | null

  pendingFolder?: string
  init: () => Promise<void>

  refresh: () => Promise<void>
  grantAccess: () => Promise<boolean>

  connectFolder: (migrate: boolean) => Promise<{ copied: number } | null>

  connectRemote: (config: RemoteConfig, migrate: boolean) => Promise<{ copied: number }>
  switchToBrowser: () => Promise<void>

  copyToFolder: () => Promise<{ copied: number; folder: string } | null>
  createSubject: (input: SubjectInput) => Promise<Subject>
  updateSubject: (id: string, input: SubjectInput) => Promise<void>
  trashSubject: (id: string) => Promise<Undo>

  trashSubjects: (ids: string[]) => Promise<Undo>
  createNote: (subjectId: string, body?: string) => Promise<Note>

  importNotes: (subjectId: string, files: File[]) => Promise<Note[]>

  saveNote: (id: string, body: string, opts?: { force?: boolean }) => Promise<void>

  adoptNote: (id: string, body: string) => void

  noteBase: (id: string) => string | undefined
  trashNote: (id: string) => Promise<Undo>

  loadNoteMap: (noteId: string) => Promise<NoteMap>
  saveNoteMap: (noteId: string, map: NoteMap) => Promise<void>

  discardIfEmpty: (id: string) => Promise<void>
  saveImage: (noteId: string, file: Blob) => Promise<string>
  createPin: (subjectId: string, input: repo.PinInput) => Promise<Pin>
  updatePin: (id: string, input: repo.PinInput) => Promise<void>

  reorderPins: (subjectId: string, ids: string[]) => Promise<void>
  trashPin: (id: string) => Promise<Undo>
  importTool: (subjectId: string, input: { name: string; html: string; icon: ToolIcon }) => Promise<Tool>

  importProjectFile: (subjectId: string, input: { name: string; blob: Blob; title?: string; icon?: ToolIcon }) => Promise<Tool>
  updateTool: (id: string, input: { name: string; icon: ToolIcon }) => Promise<void>
  trashTool: (id: string) => Promise<Undo>
  createBoard: (subjectId: string, name?: string) => Promise<Board>

  saveBoard: (id: string, data: BoardData) => Promise<BoardData | null>

  adoptBoard: (id: string, data: BoardData) => void
  renameBoard: (id: string, name: string) => Promise<void>
  trashBoard: (id: string) => Promise<Undo>

  saveBoardImage: (id: string, file: Blob) => Promise<string>
  listTrash: () => Promise<repo.TrashItem[]>
  restoreTrash: (item: repo.TrashItem) => Promise<void>

  deleteForever: (item: repo.TrashItem) => Promise<void>
}

const isBlank = (body: string) => body.replace(/^#{1,6}\s*$/gm, '').trim() === ''

let initRun: Promise<void> | null = null
let browser: VaultAdapter | null = null
const browserAdapter = () => (browser ??= createBrowserAdapter())

const forgetFolder = () => (isTauri() ? forgetPath() : forgetHandle())

const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(job)
  queues.set(key, next)
  void next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => {})
  return next
}
const idle = () => Promise.allSettled([...queues.values()])

export class NoteConflictError extends Error {
  readonly disk: string | null
  constructor(disk: string | null) {
    super('Конспект изменили снаружи')
    this.disk = disk
  }
}

const bases = new Map<string, string>()

const boardBases = new Map<string, string>()

export const useVault = create<VaultState>()((set, get) => {
  const need = () => {
    const a = get().adapter
    if (!a) throw new Error('Хранилище не открыто')
    return a
  }
  const replaceNote = (note: Note) => set((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? note : n)) }))

  const reload = async () => {
    await idle()
    set(await repo.loadVault(need()))
  }

  const trashWithUndo = async (path: string): Promise<Undo> => {
    const a = need()
    await idle()
    const trashPath = await repo.trashEntry(a, path)
    await reload()
    return async () => {
      await repo.restoreFromTrash(a, trashPath, path)
      await reload()
    }
  }

  const open = async (a: VaultAdapter) => {
    set({ status: 'loading', adapter: a, pendingFolder: undefined })
    try {
      await repo.migrateTools(a).catch((e) => console.warn('Перенос в «Проекты»', e))
      const data = await repo.loadVault(a)
      set({ ...data, status: 'ready', error: undefined })

      void repo.purgeTrash(a).catch((e) => console.warn('Очистка корзины', e))
    } catch (e) {
      console.error(e)
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    status: 'loading',
    adapter: null,
    subjects: [],
    notes: [],
    pins: [],
    tools: [],
    boards: [],

    init() {
      if (initRun && get().status !== 'error') return initRun
      initRun = (async () => {
        const remote = await loadRemoteConfig()
        if (remote) {
          const synced = new SyncedAdapter(remote)

          try {
            if (!(await synced.isReady())) await synced.initialSync()
          } catch (e) {
            set({ status: 'error', adapter: synced, error: e instanceof Error ? e.message : String(e) })
            return
          }
          return open(synced)
        }
        if (isTauri()) {
          const path = await loadSavedPath()
          return open(path ? new TauriAdapter(path) : browserAdapter())
        }
        const handle = await loadSavedHandle()
        if (handle) {
          if (await hasPermission(handle).catch(() => false)) return open(new FsaAdapter(handle))
          set({ status: 'needs-permission', pendingFolder: handle.name })
          return
        }
        await open(browserAdapter())
      })()
      return initRun
    },

    async refresh() {
      const a = get().adapter
      if (!a || get().status !== 'ready') return
      await idle()
      try {
        set(await repo.loadVault(a))
      } catch (e) {
        console.warn('Не удалось перечитать хранилище', e)
      }
    },

    async grantAccess() {
      const handle = await loadSavedHandle()
      if (!handle) return false
      if (!(await requestPermission(handle))) return false
      await open(new FsaAdapter(handle))
      return true
    },

    async connectFolder(migrate) {
      let folder: VaultAdapter
      let remember: () => Promise<unknown>
      if (isTauri()) {
        const path = await pickFolderPath()
        if (!path) return null
        folder = new TauriAdapter(path)
        remember = () => savePath(path)
      } else {
        const handle = await pickFolder()
        if (!handle) return null
        if (!(await requestPermission(handle))) throw new Error('Браузер не дал доступ к папке')
        folder = new FsaAdapter(handle)
        remember = () => saveHandle(handle)
      }
      await idle()
      const copied = migrate ? await repo.copyVault(browserAdapter(), folder) : 0
      await remember()
      await forgetRemoteConfig()
      resetSyncState()
      await open(folder)
      return { copied }
    },

    async connectRemote(config, migrate) {
      const info = await checkRemote(config)

      const full = { ...config, name: info.name || config.name, vaultId: info.vaultId }
      await idle()

      const current = get().adapter
      const source = current && current.kind !== 'remote' ? current : browserAdapter()
      resetSyncState()
      const synced = new SyncedAdapter(full)
      await synced.initialSync()
      const copied = migrate ? await repo.copyVault(source, synced) : 0

      if (copied) await synced.engine.syncNow().catch(() => {})
      await saveRemoteConfig(full)
      await forgetFolder()
      await open(synced)
      return { copied }
    },

    async copyToFolder() {
      const source = need()
      let folder: VaultAdapter
      if (isTauri()) {
        const path = await pickFolderPath()
        if (!path) return null
        folder = new TauriAdapter(path)
      } else {
        const handle = await pickFolder()
        if (!handle) return null
        if (!(await requestPermission(handle))) throw new Error('Браузер не дал доступ к папке')
        folder = new FsaAdapter(handle)
      }

      await idle()
      const copied = await repo.copyVault(source, folder, '', { overwrite: true })
      return { copied, folder: folder.label }
    },

    async switchToBrowser() {
      await idle()
      await forgetFolder()
      await forgetRemoteConfig()
      resetSyncState()
      await open(browserAdapter())
    },

    async createSubject(input) {
      const order = Math.max(-1, ...get().subjects.map((s) => s.order)) + 1
      const subject = await repo.createSubject(need(), input, order)
      set((s) => ({ subjects: [...s.subjects, subject] }))
      return subject
    },

    async updateSubject(id, input) {
      const subject = get().subjects.find((s) => s.id === id)
      if (!subject) return
      await idle()
      await repo.updateSubject(need(), subject, input)
      await reload()
    },

    async trashSubject(id) {
      const subject = get().subjects.find((s) => s.id === id)
      if (!subject) return async () => {}
      return trashWithUndo(subject.dir)
    },

    async trashSubjects(ids) {
      const a = need()
      await idle()
      const moved: { trashPath: string; dir: string }[] = []
      for (const s of get().subjects.filter((x) => ids.includes(x.id))) {
        moved.push({ trashPath: await repo.trashEntry(a, s.dir), dir: s.dir })
      }
      await reload()
      return async () => {
        for (const m of moved) await repo.restoreFromTrash(a, m.trashPath, m.dir)
        await reload()
      }
    },

    async createNote(subjectId, body) {
      const subject = get().subjects.find((s) => s.id === subjectId)
      if (!subject) throw new Error('Предмет не найден')
      const note = await repo.createNote(need(), subject, body)
      set((s) => ({ notes: [note, ...s.notes] }))
      return note
    },

    async importNotes(subjectId, files) {
      const subject = get().subjects.find((s) => s.id === subjectId)
      if (!subject) throw new Error('Предмет не найден')
      const a = need()
      const images = imagesByName(files)
      const notes: Note[] = []
      for (const f of files.filter(isMarkdownFile))
        notes.push(await repo.importNote(a, subject, { name: f.name, text: await f.text(), images }))
      set((s) => ({ notes: [...notes, ...s.notes] }))
      return notes
    },

    saveNote(id, body, opts) {
      return enqueue(id, async () => {
        const note = get().notes.find((n) => n.id === id)
        if (!note) return
        const a = need()
        if (!opts?.force) {
          const disk = await repo.readNoteBody(a, note.path)
          if (disk !== null && sameBody(disk, body)) {
            bases.set(id, body)
            if (note.body !== body) replaceNote({ ...note, body, title: extractTitle(body), excerpt: extractExcerpt(body) })
            return
          }
          if (disk === null || !sameBody(disk, bases.get(id) ?? note.body)) throw new NoteConflictError(disk)
        }
        bases.set(id, body)
        replaceNote(await repo.saveNote(a, note, body))
      })
    },

    adoptNote: (id, body) => void bases.set(id, body),
    noteBase: (id) => bases.get(id),

    discardIfEmpty(id) {
      return enqueue(id, async () => {
        const note = get().notes.find((n) => n.id === id)
        if (!note || !isBlank(note.body)) return
        await need().remove(note.path)
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
      })
    },

    async loadNoteMap(noteId) {
      const note = get().notes.find((n) => n.id === noteId)
      return note ? repo.loadNoteMap(need(), note) : emptyMap()
    },

    saveNoteMap(noteId, map) {
      return enqueue(`map:${noteId}`, async () => {
        const note = get().notes.find((n) => n.id === noteId)
        if (!note) return
        await repo.saveNoteMap(need(), note, map)
        const text = mapText(map) || undefined
        if (text !== note.mapText) set((s) => ({ notes: s.notes.map((n) => (n.id === noteId ? { ...n, mapText: text } : n)) }))
      })
    },

    trashNote(id) {
      return enqueue(id, async () => {
        const note = get().notes.find((n) => n.id === id)
        if (!note) return async () => {}
        const a = need()
        const trashPath = await repo.trashNote(a, note)
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
        return async () => {
          const path = await repo.restoreFromTrash(a, trashPath, note.path)
          set((s) => ({ notes: [{ ...note, path }, ...s.notes] }))
        }
      })
    },

    async saveImage(noteId, file) {
      const note = get().notes.find((n) => n.id === noteId)
      if (!note) throw new Error('Конспект не найден')
      return repo.saveAsset(need(), dirname(note.path), file)
    },

    async createPin(subjectId, input) {
      const subject = get().subjects.find((s) => s.id === subjectId)
      if (!subject) throw new Error('Предмет не найден')
      const order =
        Math.max(
          -1,
          ...get()
            .pins.filter((p) => p.subjectId === subjectId)
            .map((p) => p.order),
        ) + 1
      const pin = await repo.createPin(need(), subject, input, order)
      set((s) => ({ pins: [...s.pins, pin] }))
      return pin
    },

    updatePin(id, input) {
      return enqueue(id, async () => {
        const pin = get().pins.find((p) => p.id === id)
        if (!pin) return
        const next = await repo.updatePin(need(), pin, input)
        set((s) => ({ pins: s.pins.map((p) => (p.id === id ? next : p)) }))
      })
    },

    async reorderPins(subjectId, ids) {
      const a = need()

      const order = new Map(ids.map((id, i) => [id, i]))
      set((s) => ({
        pins: s.pins
          .map((p) => (p.subjectId === subjectId && order.has(p.id) ? { ...p, order: order.get(p.id)! } : p))
          .sort((x, y) => x.order - y.order || x.title.localeCompare(y.title, 'ru')),
      }))
      await Promise.all(
        get()
          .pins.filter((p) => p.subjectId === subjectId)
          .map((p) => enqueue(p.id, () => repo.updatePin(a, p, { ...p, order: p.order }))),
      )
    },

    async trashPin(id) {
      const pin = get().pins.find((p) => p.id === id)
      return pin ? trashWithUndo(pin.path) : async () => {}
    },

    async importTool(subjectId, input) {
      const subject = get().subjects.find((s) => s.id === subjectId)
      if (!subject) throw new Error('Предмет не найден')
      const tool = await repo.importTool(need(), subject, input)
      set((s) => ({ tools: [...s.tools, tool].sort((x, y) => x.name.localeCompare(y.name, 'ru')) }))
      return tool
    },

    async importProjectFile(subjectId, input) {
      const subject = get().subjects.find((s) => s.id === subjectId)
      if (!subject) throw new Error('Предмет не найден')
      const tool = await repo.importProjectFile(need(), subject, input)
      set((s) => ({ tools: [...s.tools, tool].sort((x, y) => x.name.localeCompare(y.name, 'ru')) }))
      return tool
    },

    updateTool(id, input) {
      return enqueue(id, async () => {
        const tool = get().tools.find((t) => t.id === id)
        if (!tool) return
        const next = await repo.updateTool(need(), tool, input)
        set((s) => ({ tools: s.tools.map((t) => (t.id === id ? next : t)) }))
      })
    },

    async trashTool(id) {
      const tool = get().tools.find((t) => t.id === id)
      return tool ? trashWithUndo(tool.path) : async () => {}
    },

    async createBoard(subjectId, name = 'Новая доска') {
      const subject = get().subjects.find((s) => s.id === subjectId)
      if (!subject) throw new Error('Предмет не найден')
      const board = await repo.createBoard(need(), subject, name)
      boardBases.set(board.id, serializeBoard(board.id, board.data))
      set((s) => ({ boards: [...s.boards, board].sort((x, y) => x.name.localeCompare(y.name, 'ru')) }))
      return board
    },

    saveBoard(id, data) {
      return enqueue(`board:${id}`, async () => {
        const board = get().boards.find((b) => b.id === id)
        if (!board) return null
        const a = need()
        const text = await a.readText(board.path)
        const disk = text === null ? null : serializeBoard(id, parseBoard(text).data)
        const base = boardBases.get(id)
        const next =
          disk !== null && base !== undefined && disk !== base ? mergeBoards(parseBoard(base).data, data, parseBoard(disk).data) : data
        const saved = await repo.saveBoard(a, board, next)
        boardBases.set(id, serializeBoard(id, next))
        set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, data: saved.data } : b)) }))
        return next
      })
    },

    adoptBoard: (id, data) => void boardBases.set(id, serializeBoard(id, data)),

    renameBoard(id, name) {
      return enqueue(`board:${id}`, async () => {
        const board = get().boards.find((b) => b.id === id)
        if (!board) return
        const next = await repo.renameBoard(need(), board, name)
        set((s) => ({ boards: s.boards.map((b) => (b.id === id ? next : b)).sort((x, y) => x.name.localeCompare(y.name, 'ru')) }))
      })
    },

    async trashBoard(id) {
      const board = get().boards.find((b) => b.id === id)
      return board ? trashWithUndo(board.path) : async () => {}
    },

    async saveBoardImage(id, file) {
      const board = get().boards.find((b) => b.id === id)
      if (!board) throw new Error('Доска не найдена')
      return repo.saveBoardImage(need(), board, file)
    },

    listTrash: () => repo.listTrash(need()),

    async restoreTrash(item) {
      await repo.restoreFromTrash(need(), item.trashPath, item.originalPath)
      await reload()
    },

    async deleteForever(item) {
      await need().remove(item.trashPath)
    },
  }
})

const urlCache = new Map<string, Promise<string | null>>()
export function vaultFileUrl(path: string): Promise<string | null> {
  const a = useVault.getState().adapter
  if (!a) return Promise.resolve(null)
  const key = `${a.kind}:${a.label}:${path}`
  if (!urlCache.has(key)) {
    urlCache.set(
      key,

      a.readBlob(path).then(
        (b) => (b ? URL.createObjectURL(b) : null),
        (e) => {
          urlCache.delete(key)
          throw e
        },
      ),
    )
  }
  return urlCache.get(key)!
}
