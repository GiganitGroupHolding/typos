import { create } from 'zustand'
import { genId, NOTES_DIR, parseFrontmatter, serializeFrontmatter, SUBJECT_META } from '@/vault/format'
import { getHtmlMeta, setHtmlMeta } from '@/vault/repo'
import type { FlatStore } from './flatAdapter'
import { RemoteError, type RemoteAdapter } from './remoteAdapter'
import { basename, dirname, joinPath } from './VaultAdapter'

/**
 * Синхронизация локальной копии vault с сервером хранения.
 * Приложение пишет только в локальную копию; движок сравнивает три состояния каждого файла —
 * локальное, серверное и то, что было при прошлой синхронизации, — и решает, что куда отправить.
 * Ничего не теряется: если файл правили с обеих сторон, наша версия сохраняется копией рядом.
 */

/** Что известно о файле с прошлой синхронизации. */
export interface MetaEntry {
  /** ETag на сервере при прошлой синхронизации; нет — файла на сервере не было. */
  etag?: string
  /** Счётчик правок на этом устройстве. */
  rev: number
  /** rev, который уже на сервере. rev ≠ synced — есть неотправленные правки. */
  synced: number
}

export interface MetaStore {
  get(path: string): Promise<MetaEntry | undefined>
  set(path: string, entry: MetaEntry): Promise<void>
  /** Атомарное чтение-изменение-запись (другие вкладки пишут в ту же базу). */
  update(path: string, fn: (cur: MetaEntry | undefined) => MetaEntry): Promise<void>
  del(path: string): Promise<void>
  entries(): Promise<[string, MetaEntry][]>
}

/** Локальная копия: файлы, сведения о синхронизации и замок, под которым меняются файлы. */
export interface Replica {
  files: FlatStore
  meta: MetaStore
  lock<T>(job: () => Promise<T>): Promise<T>
}

/** Локальная правка: rev растёт, файл становится «неотправленным». */
export const touched = (cur: MetaEntry | undefined): MetaEntry => ({ etag: cur?.etag, rev: (cur?.rev ?? 0) + 1, synced: cur?.synced ?? 0 })

export interface SyncState {
  /** Правки на этом устройстве, ещё не отправленные на сервер. */
  pending: number
  syncing: boolean
  lastSync?: number
  /** Файлы, которые сервер не принимает (слишком большой и т. п.): путь → причина. */
  failed: Record<string, string>
}

export const useSync = create<SyncState>(() => ({ pending: 0, syncing: false, failed: {} }))

export interface EngineHooks {
  /** Файлы в локальной копии поменялись с сервера. */
  onPulled?: () => void
  /** Файл правили и здесь, и на сервере: наша версия сохранена копией. */
  onConflict?: (path: string, copy: string) => void
  /** Связи нет — запланированные синхронизации не дёргают сеть зря. */
  isOffline?: () => boolean
}

const TEXT_FILE = /\.(md|json|html?|txt|css|js|svg)$/i
const toBlob = (v: string | Blob) => (typeof v === 'string' ? new Blob([v]) : v)
// BOM оставляем в строке, битый UTF-8 — ошибка: строка обратно в байты должна дать ровно те же байты, иначе ложный конфликт
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** В локальной копии текстовые файлы — строками (так их быстрее читать), остальное и текст не в UTF-8 — Blob. */
export async function fromBlob(path: string, blob: Blob): Promise<string | Blob> {
  if (!TEXT_FILE.test(path)) return blob
  try {
    return utf8.decode(await blob.arrayBuffer())
  } catch {
    return blob
  }
}

async function sameBytes(a: Blob, b: Blob) {
  if (a.size !== b.size) return false
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()])
  const u = new Uint8Array(x)
  const v = new Uint8Array(y)
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false
  return true
}

/** У одного конспекта может отличаться только время повторного сохранения. */
async function sameNote(path: string, a: Blob, b: Blob): Promise<boolean> {
  if (!path.endsWith('.md') || basename(dirname(path)) !== NOTES_DIR) return false
  try {
    const stripUpdated = async (blob: Blob) => {
      const text = utf8
        .decode(await blob.arrayBuffer())
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
      if (!text.startsWith('---\n') || !parseFrontmatter(text).meta.id) return null
      const end = text.indexOf('\n---', 4)
      if (end < 0) return null
      return text.slice(0, end).replace(/^updated:[^\n]*$/m, '') + text.slice(end)
    }
    const [left, right] = await Promise.all([stripUpdated(a), stripUpdated(b)])
    return left !== null && left === right
  } catch {
    return false
  }
}

/**
 * Наша версия файла, который на сервере успели изменить: «Имя (конфликт 18.10 14-05).md».
 * У конспектов, карточек и тулз новый id и пометка в заголовке, чтобы в приложении это были две разные записи.
 */
export function conflictCopy(
  path: string,
  value: string | Blob,
  taken: Set<string>,
  when = new Date(),
): { path: string; value: string | Blob } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const label = `конфликт ${pad(when.getDate())}.${pad(when.getMonth() + 1)} ${pad(when.getHours())}-${pad(when.getMinutes())}`
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let copy = joinPath(dirname(path), `${base} (${label})${ext}`)
  for (let i = 2; taken.has(copy); i++) copy = joinPath(dirname(path), `${base} (${label}, ${i})${ext}`)

  if (typeof value !== 'string') return { path: copy, value }
  if (/\.md$/i.test(path)) {
    const { meta, body } = parseFrontmatter(value)
    if (!meta.id) return { path: copy, value }
    const marked = body.replace(/^(#{1,6} .*)$/m, `$1 (${label})`)
    return { path: copy, value: serializeFrontmatter({ ...meta, id: genId() }, marked) }
  }
  if (/\.html?$/i.test(path) && getHtmlMeta(value, 'studynotes-id'))
    return { path: copy, value: setHtmlMeta(value, 'studynotes-id', genId()) }
  return { path: copy, value }
}

interface Pass {
  /** Нужен ещё проход: появились копии конфликтов или файл поменяли, пока мы его разбирали. */
  more: boolean
  pulled: boolean
  taken: Set<string>
  failed: Record<string, string>
}

export class SyncEngine {
  hooks: EngineHooks = {}
  private readonly replica: Replica
  private readonly remote: RemoteAdapter
  private timer?: ReturnType<typeof setTimeout>
  private running: Promise<void> | null = null
  private again = false

  constructor(replica: Replica, remote: RemoteAdapter) {
    this.replica = replica
    this.remote = remote
  }

  /** Синхронизировать чуть позже: правки подряд уходят одним проходом. */
  schedule(ms = 300) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.hooks.isOffline?.()) return void this.refreshPending()
      this.syncNow().catch(() => {})
    }, ms)
  }

  cancel() {
    clearTimeout(this.timer)
  }

  /** Синхронизировать сейчас. Нет связи — бросает; неотправленное остаётся в локальной копии. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      useSync.setState({ syncing: true })
      try {
        do {
          this.again = false
          // проход просит ещё один (копии конфликтов, правки во время прохода) — до трёх подряд
          let passes = 0
          while ((await this.pass()) && ++passes < 3) {
            // следующий проход
          }
        } while (this.again)
        useSync.setState({ lastSync: Date.now() })
      } finally {
        this.running = null
        useSync.setState({ syncing: false })
        await this.refreshPending()
      }
    })()
    return this.running
  }

  async countPending() {
    const meta = new Map(await this.replica.meta.entries())
    let n = 0
    for (const m of meta.values()) if (m.rev !== m.synced) n++
    for (const path of await this.replica.files.keys()) if (!meta.has(path)) n++
    return n
  }

  async refreshPending() {
    useSync.setState({ pending: await this.countPending() })
  }

  private async pass(): Promise<boolean> {
    const manifest = await this.remote.manifest()
    const meta = new Map(await this.replica.meta.entries())
    const local = new Set(await this.replica.files.keys())
    const remote = Object.keys(manifest.files)
    const ctx: Pass = { more: false, pulled: false, taken: new Set([...local, ...remote]), failed: {} }
    for (const path of new Set([...meta.keys(), ...remote, ...local])) {
      try {
        await this.syncPath(path, meta.get(path), manifest.files[path]?.etag, local.has(path), ctx)
      } catch (e) {
        // сервер отказал в одном файле — остальные синхронизируем; нет связи — прерываемся целиком
        if (!(e instanceof RemoteError) || e.status === undefined || e.status === 401) throw e
        ctx.failed[path] = e.message
      }
    }
    useSync.setState({ failed: ctx.failed })
    if (ctx.pulled) this.hooks.onPulled?.()
    return ctx.more
  }

  private async syncPath(path: string, m: MetaEntry | undefined, remoteEtag: string | undefined, hasLocal: boolean, ctx: Pass) {
    const dirty = m ? m.rev !== m.synced : hasLocal
    const remoteChanged = remoteEtag !== m?.etag
    if (!dirty && !remoteChanged) {
      // удалён с обеих сторон — сведения больше не нужны
      if (m && !hasLocal && remoteEtag === undefined) await this.replica.meta.del(path)
      return
    }
    if (dirty && !remoteChanged) return this.push(path, m, hasLocal, ctx)
    if (!dirty) return this.pull(path, remoteEtag, ctx)
    return this.resolve(path, m, ctx)
  }

  /** Правка здесь, на сервере без изменений — отправляем с условием «поверх той же версии». */
  private async push(path: string, m: MetaEntry | undefined, hasLocal: boolean, ctx: Pass) {
    const rev = m?.rev ?? 0
    if (!hasLocal) {
      if (m?.etag && (await this.remote.del(path, m.etag)) === 'conflict') return this.retryOrResolve(path, m, ctx)
      await this.dropMeta(path, rev)
      return
    }
    const value = await this.replica.files.get(path)
    if (value === undefined) return void (ctx.more = true)
    const res = await this.remote.put(path, toBlob(value), m?.etag)
    if (res === 'conflict') return this.retryOrResolve(path, m, ctx)
    await this.replica.meta.update(path, (cur) => ({ etag: res.etag, rev: cur?.rev ?? rev, synced: rev }))
  }

  /** Сервер отказал по условию. Может, это другая вкладка уже отправила файл — тогда просто ещё проход. */
  private async retryOrResolve(path: string, m: MetaEntry | undefined, ctx: Pass) {
    const fresh = await this.replica.meta.get(path)
    if (fresh?.etag !== m?.etag) return void (ctx.more = true)
    return this.resolve(path, m, ctx)
  }

  /** Здесь без правок, на сервере изменили — забираем. */
  private async pull(path: string, remoteEtag: string | undefined, ctx: Pass) {
    if (remoteEtag === undefined) {
      await this.replica.lock(async () => {
        const cur = await this.replica.meta.get(path)
        if (cur && cur.rev !== cur.synced) return void (ctx.more = true)
        await this.replica.files.del([path])
        await this.replica.meta.del(path)
        ctx.pulled = true
      })
      return
    }
    const got = await this.remote.get(path)
    if (!got) return void (ctx.more = true)
    const value = await fromBlob(path, got.blob)
    await this.replica.lock(async () => {
      const cur = await this.replica.meta.get(path)
      // пока качали, здесь успели поправить — разберёмся на следующем проходе
      if (cur ? cur.rev !== cur.synced : (await this.replica.files.get(path)) !== undefined) return void (ctx.more = true)
      await this.replica.files.set(path, value)
      await this.replica.meta.set(path, { etag: got.etag, rev: cur?.rev ?? 0, synced: cur?.rev ?? 0 })
      ctx.pulled = true
    })
  }

  /** Меняли с обеих сторон. */
  private async resolve(path: string, m: MetaEntry | undefined, ctx: Pass) {
    const rev = m?.rev ?? 0
    const got = await this.remote.get(path)
    const mine = await this.replica.files.get(path)
    if (!got && mine === undefined) return this.dropMeta(path, rev)
    if (!got) {
      // здесь правили, на сервере удалили — правка важнее удаления: возвращаем файл
      const res = await this.remote.put(path, toBlob(mine!))
      if (res === 'conflict') return void (ctx.more = true)
      await this.replica.meta.update(path, (cur) => ({ etag: res.etag, rev: cur?.rev ?? rev, synced: rev }))
      return
    }
    // здесь удалили, на сервере правили — тоже правка важнее: берём серверную.
    // Одинаковое содержимое — просто запоминаем версию. Цвет и порядок предмета — берём с сервера.
    if (
      mine === undefined ||
      (await sameBytes(toBlob(mine), got.blob)) ||
      (await sameNote(path, toBlob(mine), got.blob)) ||
      basename(path) === SUBJECT_META
    )
      return this.adopt(path, got, rev, ctx)
    const copy = conflictCopy(path, mine, ctx.taken)
    ctx.taken.add(copy.path)
    await this.adopt(path, got, rev, ctx, async () => {
      await this.replica.files.set(copy.path, copy.value)
      await this.replica.meta.update(copy.path, touched)
      this.hooks.onConflict?.(path, copy.path)
    })
    ctx.more = true
  }

  /** Кладём серверную версию в локальную копию (и, если надо, нашу — копией рядом). */
  private async adopt(path: string, got: { blob: Blob; etag: string }, rev: number, ctx: Pass, before?: () => Promise<void>) {
    const value = await fromBlob(path, got.blob)
    await this.replica.lock(async () => {
      const cur = await this.replica.meta.get(path)
      if ((cur?.rev ?? 0) !== rev) return void (ctx.more = true)
      await before?.()
      await this.replica.files.set(path, value)
      await this.replica.meta.set(path, { etag: got.etag, rev, synced: rev })
      ctx.pulled = true
    })
  }

  /** Удалить сведения о файле, если с тех пор его не создали заново. */
  private dropMeta(path: string, rev: number) {
    return this.replica.lock(async () => {
      const cur = await this.replica.meta.get(path)
      if ((cur?.rev ?? 0) === rev) await this.replica.meta.del(path)
    })
  }
}
