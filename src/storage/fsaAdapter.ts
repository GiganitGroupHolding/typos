import { del, get, set } from 'idb-keyval'
import { settingsStore } from './settings'
import { basename, dirname, type Entry, type VaultAdapter } from './VaultAdapter'

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')

export class FsaAdapter implements VaultAdapter {
  readonly kind = 'folder' as const
  readonly label: string
  readonly root: FileSystemDirectoryHandle

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root
    this.label = root.name
  }

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle | null> {
    let h = this.root
    for (const part of path.split('/').filter(Boolean)) {
      try {
        h = await h.getDirectoryHandle(part, { create })
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    }
    return h
  }

  private async file(path: string, create = false): Promise<FileSystemFileHandle | null> {
    const parent = await this.dir(dirname(path), create)
    if (!parent) return null
    try {
      return await parent.getFileHandle(basename(path), { create })
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  async list(path: string): Promise<Entry[]> {
    const d = await this.dir(path)
    if (!d) return []
    const out: Entry[] = []
    for await (const [name, h] of d.entries()) out.push({ name, kind: h.kind === 'directory' ? 'dir' : 'file' })
    return out
  }

  async readBlob(path: string) {
    const f = await this.file(path)
    return f ? await f.getFile() : null
  }

  async readText(path: string) {
    const b = await this.readBlob(path)
    return b ? await b.text() : null
  }

  async writeBlob(path: string, blob: Blob) {
    const f = await this.file(path, true)
    const w = await f!.createWritable()
    try {
      await w.write(blob)
    } finally {
      await w.close()
    }
  }

  writeText(path: string, text: string) {
    return this.writeBlob(path, new Blob([text], { type: 'text/plain;charset=utf-8' }))
  }

  async exists(path: string) {
    if (!path) return true
    const parent = await this.dir(dirname(path))
    if (!parent) return false
    const name = basename(path)
    for await (const [n] of parent.entries()) if (n === name) return true
    return false
  }

  async remove(path: string) {
    const parent = await this.dir(dirname(path))
    try {
      await parent?.removeEntry(basename(path), { recursive: true })
    } catch (e) {
      if (!isNotFound(e)) throw e
    }
  }

  async move(from: string, to: string) {
    if (from === to) return
    if (await this.exists(to)) throw new Error(`Уже существует: ${to}`)

    await this.copy(from, to)
    await this.remove(from)
  }

  private async copy(from: string, to: string) {
    const f = await this.file(from)
    if (f) {
      await this.writeBlob(to, await f.getFile())
      return
    }
    for (const e of await this.list(from)) await this.copy(`${from}/${e.name}`, `${to}/${e.name}`)
    await this.dir(to, true)
  }
}

const HANDLE_KEY = 'vaultHandle'

export const fsaSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export const loadSavedHandle = () => get<FileSystemDirectoryHandle>(HANDLE_KEY, settingsStore).catch(() => undefined)
export const saveHandle = (h: FileSystemDirectoryHandle) => set(HANDLE_KEY, h, settingsStore)
export const forgetHandle = () => del(HANDLE_KEY, settingsStore)

export async function hasPermission(h: FileSystemDirectoryHandle) {
  return (await h.queryPermission({ mode: 'readwrite' })) === 'granted'
}

export async function requestPermission(h: FileSystemDirectoryHandle) {
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await window.showDirectoryPicker!({ id: 'studynotes', mode: 'readwrite', startIn: 'documents' })) ?? null
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}
