import { createStore, del, delMany, entries, get, keys, set, update, type UseStore } from "idb-keyval"
import { monitorConnection, useConnection } from "./connection"
import { FlatAdapter, type FlatStore } from "./flatAdapter"
import { RemoteAdapter } from "./remoteAdapter"
import type { RemoteConfig } from "./remoteLink"
import { fromBlob, SyncEngine, touched, useSync, type EngineHooks, type MetaEntry, type MetaStore, type Replica } from "./sync"
import type { Entry, VaultAdapter } from "./VaultAdapter"

const INTERNAL = "\u0000"
const READY_KEY = `${INTERNAL}ready`

function idbFiles(store: UseStore): FlatStore {
  return {
    get: (p) => get<string | Blob>(p, store),
    set: (p, v) => set(p, v, store),
    del: (ps) => (ps.length === 1 ? del(ps[0], store) : delMany(ps, store)),
    keys: async () => (await keys(store)).map(String),
  }
}

function idbMeta(store: UseStore): MetaStore {
  return {
    get: (p) => get<MetaEntry>(p, store),
    set: (p, m) => set(p, m, store),
    update: (p, fn) => update<MetaEntry>(p, fn, store),
    del: (p) => del(p, store),
    entries: async () =>
      (await entries<IDBValidKey, MetaEntry>(store)).filter(([k]) => !String(k).startsWith(INTERNAL)).map(([k, v]) => [String(k), v]),
  }
}

export interface SyncHooks {
  onChanged?: () => void

  onConflict?: EngineHooks["onConflict"]

  onReconnected?: () => void
}

export class SyncedAdapter implements VaultAdapter {
  readonly kind = "remote" as const
  readonly label: string
  readonly config: RemoteConfig
  readonly remote: RemoteAdapter
  readonly engine: SyncEngine

  onChanged?: () => void

  private readonly ownHooks: EngineHooks = { onPulled: () => this.changed(true) }

  private readonly files: FlatStore
  private readonly metaStore: UseStore
  private readonly local: FlatAdapter
  private readonly replica: Replica
  private queue: Promise<unknown> = Promise.resolve()
  private channel?: BroadcastChannel
  private periodic?: ReturnType<typeof setInterval>
  private stopMonitor?: () => void

  constructor(config: RemoteConfig, scope = "") {
    this.config = config
    this.label = config.name
    this.remote = new RemoteAdapter(config)
    const db = `typos-sync-${config.vaultId}${scope ? `-${scope}` : ""}`
    this.files = idbFiles(createStore(`${db}-files`, "files"))
    this.metaStore = createStore(`${db}-meta`, "meta")
    this.local = new FlatAdapter(this.files, "remote", config.name)
    this.replica = { files: this.files, meta: idbMeta(this.metaStore), lock: (job) => this.lock(job) }
    this.engine = new SyncEngine(this.replica, this.remote)
    this.engine.hooks = { ...this.ownHooks }
  }

  async isReady() {
    return (await get<boolean>(READY_KEY, this.metaStore)) === true
  }

  async initialSync() {
    await this.engine.syncNow()
    await set(READY_KEY, true, this.metaStore)
  }

  start(hooks: SyncHooks = {}) {
    this.stop()
    this.onChanged = hooks.onChanged
    this.engine.hooks = {
      ...this.ownHooks,
      onConflict: hooks.onConflict,
      isOffline: () => useConnection.getState().status !== "online",
    }
    this.channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(`typos-sync-${this.config.vaultId}`)
    if (this.channel) this.channel.onmessage = () => this.onChanged?.()
    this.stopMonitor = monitorConnection(this.remote, {
      onChange: (status, prev) => {
        if (status !== "online") return
        this.engine.schedule(0)
        if (prev === "offline") hooks.onReconnected?.()
      },
      onServerChange: () => this.engine.schedule(150),
    })

    this.periodic = setInterval(() => this.engine.schedule(0), 60_000)
    this.engine.schedule(0)
    void this.engine.refreshPending()
  }

  stop() {
    this.stopMonitor?.()
    this.stopMonitor = undefined
    clearInterval(this.periodic)
    this.engine.cancel()
    this.channel?.close()
    this.channel = undefined
    this.onChanged = undefined
    this.engine.hooks = { ...this.ownHooks }
  }

  private lock<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => {})
    return next
  }

  private changed(fromServer: boolean) {
    this.channel?.postMessage("changed")
    if (fromServer) this.onChanged?.()
  }

  private async under(path: string) {
    return (await this.files.keys()).filter((k) => k === path || k.startsWith(`${path}/`))
  }

  private async edit(job: () => Promise<string[]>) {
    await this.lock(async () => {
      for (const path of await job()) await this.replica.meta.update(path, touched)
    })
    this.changed(false)
    this.engine.schedule()
    void this.engine.refreshPending()
  }

  list(dir: string): Promise<Entry[]> {
    return this.local.list(dir)
  }

  readText(path: string) {
    return this.local.readText(path)
  }

  readBlob(path: string) {
    return this.local.readBlob(path)
  }

  exists(path: string) {
    return this.local.exists(path)
  }

  writeText(path: string, text: string) {
    return this.edit(async () => {
      await this.local.writeText(path, text)
      return [path]
    })
  }

  writeBlob(path: string, blob: Blob) {
    return this.edit(async () => {
      const value = await fromBlob(path, blob)
      await (typeof value === "string" ? this.local.writeText(path, value) : this.local.writeBlob(path, value))
      return [path]
    })
  }

  remove(path: string) {
    return this.edit(async () => {
      const paths = await this.under(path)
      await this.local.remove(path)
      return paths
    })
  }

  move(from: string, to: string) {
    return this.edit(async () => {
      const paths = await this.under(from)
      await this.local.move(from, to)
      return [...paths, ...paths.map((p) => to + p.slice(from.length))]
    })
  }
}

export const resetSyncState = () => useSync.setState({ pending: 0, syncing: false, failed: {}, lastSync: undefined })
