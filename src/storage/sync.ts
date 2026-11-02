import { create } from 'zustand'
import { genId, NOTES_DIR, parseFrontmatter, serializeFrontmatter, SUBJECT_META } from '@/vault/format'
import { mergeText } from '@/vault/mergeText'
import { getHtmlMeta, setHtmlMeta } from '@/vault/repo'
import type { FlatStore } from './flatAdapter'
import { RemoteError, type RemoteAdapter } from './remoteAdapter'
import { basename, dirname, joinPath } from './VaultAdapter'

export interface MetaEntry {
  etag?: string
  base?: string

  rev: number

  synced: number
}

export interface MetaStore {
  get(path: string): Promise<MetaEntry | undefined>
  set(path: string, entry: MetaEntry): Promise<void>

  update(path: string, fn: (cur: MetaEntry | undefined) => MetaEntry): Promise<void>
  del(path: string): Promise<void>
  entries(): Promise<[string, MetaEntry][]>
}

export interface Replica {
  files: FlatStore
  meta: MetaStore
  lock<T>(job: () => Promise<T>): Promise<T>
}

export const touched = (cur: MetaEntry | undefined): MetaEntry => ({
  etag: cur?.etag,
  base: cur?.base,
  rev: (cur?.rev ?? 0) + 1,
  synced: cur?.synced ?? 0,
})

export interface SyncState {
  pending: number
  syncing: boolean
  lastSync?: number

  failed: Record<string, string>
}

export const useSync = create<SyncState>(() => ({ pending: 0, syncing: false, failed: {} }))

export interface EngineHooks {
  onPulled?: () => void

  onConflict?: (path: string, copy: string) => void

  isOffline?: () => boolean
}

const TEXT_FILE = /\.(md|json|html?|txt|css|js|svg)$/i
const toBlob = (v: string | Blob) => (typeof v === 'string' ? new Blob([v]) : v)
const noteBase = (path: string, value: string | Blob) =>
  path.endsWith('.md') && basename(dirname(path)) === NOTES_DIR && typeof value === 'string' ? value : undefined

function mergeNote(base: string, mine: string, theirs: string): string | null {
  const [b, m, t] = [base, mine, theirs].map(parseFrontmatter)
  if (!b.meta.id || b.meta.id !== m.meta.id || b.meta.id !== t.meta.id) return null
  const body = mergeText(b.body, m.body, t.body)
  if (body === null) return null
  const meta: Record<string, string> = {}
  for (const key of new Set([...Object.keys(b.meta), ...Object.keys(m.meta), ...Object.keys(t.meta)])) {
    if (key !== 'updated' && m.meta[key] !== t.meta[key] && m.meta[key] !== b.meta[key] && t.meta[key] !== b.meta[key]) return null
    const value = key === 'updated' || m.meta[key] === b.meta[key] ? t.meta[key] : m.meta[key]
    if (value !== undefined) meta[key] = value
  }
  return serializeFrontmatter(meta, body)
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

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

          let passes = 0
          while ((await this.pass()) && ++passes < 3) {}
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
      if (m && hasLocal && m.base === undefined && path.endsWith('.md') && basename(dirname(path)) === NOTES_DIR) {
        await this.replica.lock(async () => {
          const cur = await this.replica.meta.get(path)
          if (!cur || cur.etag !== m.etag || cur.rev !== cur.synced) return
          const value = await this.replica.files.get(path)
          const base = value === undefined ? undefined : noteBase(path, value)
          if (base !== undefined) await this.replica.meta.set(path, { ...cur, base })
        })
      }
      if (m && !hasLocal && remoteEtag === undefined) await this.replica.meta.del(path)
      return
    }
    if (dirty && !remoteChanged) return this.push(path, m, hasLocal, ctx)
    if (!dirty) return this.pull(path, remoteEtag, ctx)
    return this.resolve(path, m, ctx)
  }

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
    await this.replica.meta.update(path, (cur) => ({ etag: res.etag, base: noteBase(path, value), rev: cur?.rev ?? rev, synced: rev }))
  }

  private async retryOrResolve(path: string, m: MetaEntry | undefined, ctx: Pass) {
    const fresh = await this.replica.meta.get(path)
    if (fresh?.etag !== m?.etag) return void (ctx.more = true)
    return this.resolve(path, m, ctx)
  }

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

      if (cur ? cur.rev !== cur.synced : (await this.replica.files.get(path)) !== undefined) return void (ctx.more = true)
      await this.replica.files.set(path, value)
      await this.replica.meta.set(path, { etag: got.etag, base: noteBase(path, value), rev: cur?.rev ?? 0, synced: cur?.rev ?? 0 })
      ctx.pulled = true
    })
  }

  private async resolve(path: string, m: MetaEntry | undefined, ctx: Pass) {
    const rev = m?.rev ?? 0
    const got = await this.remote.get(path)
    const mine = await this.replica.files.get(path)
    if (!got && mine === undefined) return this.dropMeta(path, rev)
    if (!got) {
      const res = await this.remote.put(path, toBlob(mine!))
      if (res === 'conflict') return void (ctx.more = true)
      await this.replica.meta.update(path, (cur) => ({ etag: res.etag, base: noteBase(path, mine!), rev: cur?.rev ?? rev, synced: rev }))
      return
    }

    if (
      mine === undefined ||
      (await sameBytes(toBlob(mine), got.blob)) ||
      (await sameNote(path, toBlob(mine), got.blob)) ||
      basename(path) === SUBJECT_META
    )
      return this.adopt(path, got, rev, ctx)
    if (m?.base !== undefined && typeof mine === 'string') {
      const theirs = await fromBlob(path, got.blob)
      const merged = typeof theirs === 'string' ? mergeNote(m.base, mine, theirs) : null
      if (merged !== null) {
        await this.replica.lock(async () => {
          const cur = await this.replica.meta.get(path)
          if ((cur?.rev ?? 0) !== rev) return void (ctx.more = true)
          await this.replica.files.set(path, merged)
          await this.replica.meta.set(path, { etag: got.etag, base: noteBase(path, theirs), rev: rev + 1, synced: rev })
          ctx.pulled = true
        })
        ctx.more = true
        return
      }
    }
    const copy = conflictCopy(path, mine, ctx.taken)
    ctx.taken.add(copy.path)
    await this.adopt(path, got, rev, ctx, async () => {
      await this.replica.files.set(copy.path, copy.value)
      await this.replica.meta.update(copy.path, touched)
      this.hooks.onConflict?.(path, copy.path)
    })
    ctx.more = true
  }

  private async adopt(path: string, got: { blob: Blob; etag: string }, rev: number, ctx: Pass, before?: () => Promise<void>) {
    const value = await fromBlob(path, got.blob)
    await this.replica.lock(async () => {
      const cur = await this.replica.meta.get(path)
      if ((cur?.rev ?? 0) !== rev) return void (ctx.more = true)
      await before?.()
      await this.replica.files.set(path, value)
      await this.replica.meta.set(path, { etag: got.etag, base: noteBase(path, value), rev, synced: rev })
      ctx.pulled = true
    })
  }

  private dropMeta(path: string, rev: number) {
    return this.replica.lock(async () => {
      const cur = await this.replica.meta.get(path)
      if ((cur?.rev ?? 0) === rev) await this.replica.meta.del(path)
    })
  }
}
