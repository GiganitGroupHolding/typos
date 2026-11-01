import type { Entry, VaultAdapter } from './VaultAdapter'

export interface FlatStore {
  get(path: string): Promise<string | Blob | undefined>
  set(path: string, value: string | Blob): Promise<void>
  del(paths: string[]): Promise<void>
  keys(): Promise<string[]>
}

export class FlatAdapter implements VaultAdapter {
  private store: FlatStore
  readonly kind: VaultAdapter['kind']
  readonly label: string

  constructor(store: FlatStore, kind: VaultAdapter['kind'], label: string) {
    this.store = store
    this.kind = kind
    this.label = label
  }

  async list(dir: string): Promise<Entry[]> {
    const prefix = dir ? `${dir}/` : ''
    const seen = new Map<string, Entry['kind']>()
    for (const key of await this.store.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const [head, ...tail] = rest.split('/')
      if (!head) continue

      if (!tail.length && head === '.keep') continue
      seen.set(head, tail.length ? 'dir' : (seen.get(head) ?? 'file'))
    }
    return [...seen].map(([name, kind]) => ({ name, kind }))
  }

  async readText(path: string) {
    const v = await this.store.get(path)
    if (v === undefined) return null
    return typeof v === 'string' ? v : await v.text()
  }

  writeText(path: string, text: string) {
    return this.store.set(path, text)
  }

  async readBlob(path: string) {
    const v = await this.store.get(path)
    if (v === undefined) return null
    return typeof v === 'string' ? new Blob([v]) : v
  }

  writeBlob(path: string, blob: Blob) {
    return this.store.set(path, blob)
  }

  async exists(path: string) {
    if ((await this.store.get(path)) !== undefined) return true
    const prefix = `${path}/`
    return (await this.store.keys()).some((k) => k.startsWith(prefix))
  }

  private async under(path: string) {
    const prefix = `${path}/`
    return (await this.store.keys()).filter((k) => k === path || k.startsWith(prefix))
  }

  async remove(path: string) {
    await this.store.del(await this.under(path))
  }

  async move(from: string, to: string) {
    if (from === to) return
    if (await this.exists(to)) throw new Error(`Уже существует: ${to}`)
    const keys = await this.under(from)
    for (const key of keys) {
      const value = await this.store.get(key)
      if (value !== undefined) await this.store.set(to + key.slice(from.length), value)
    }
    await this.store.del(keys)
  }
}

export function createMemoryAdapter(initial: Record<string, string> = {}) {
  const map = new Map<string, string | Blob>(Object.entries(initial))
  return new FlatAdapter(
    {
      get: async (p) => map.get(p),
      set: async (p, v) => void map.set(p, v),
      del: async (ps) => ps.forEach((p) => map.delete(p)),
      keys: async () => [...map.keys()],
    },
    'memory',
    'Память',
  )
}
