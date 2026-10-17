import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { createStore, del, get, set } from 'idb-keyval'
import type { Entry, VaultAdapter } from './VaultAdapter'

/**
 * Папка на диске в десктопном приложении (Tauri): файлы читает и пишет Rust (src-tauri/src/vault.rs).
 * Разрешений браузера нет — путь к папке просто запоминается.
 */

export { isTauri }

/** Rust так сообщает, что файла нет. */
const MISSING = 'ENOENT'
const decoder = new TextDecoder()

const call = <T>(cmd: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]) =>
  invoke<T>(cmd, args, options).catch((e: unknown) => {
    throw e === MISSING ? e : new Error(String(e))
  })

export class TauriAdapter implements VaultAdapter {
  readonly kind = 'folder' as const
  readonly label: string
  readonly root: string

  constructor(root: string) {
    this.root = root
    this.label = root.split(/[\\/]/).filter(Boolean).pop() ?? root
  }

  list(dir: string) {
    return call<Entry[]>('vault_list', { root: this.root, dir })
  }

  private async read(path: string): Promise<ArrayBuffer | null> {
    try {
      return await call<ArrayBuffer>('vault_read', { root: this.root, path })
    } catch (e) {
      if (e === MISSING) return null
      throw e
    }
  }

  async readText(path: string) {
    const buf = await this.read(path)
    return buf ? decoder.decode(buf) : null
  }

  async readBlob(path: string) {
    const buf = await this.read(path)
    return buf ? new Blob([buf]) : null
  }

  async writeText(path: string, text: string) {
    await call('vault_write_text', { root: this.root, path, text })
  }

  async writeBlob(path: string, blob: Blob) {
    // байты идут телом запроса, без JSON; в заголовках только ASCII
    await call('vault_write_bytes', new Uint8Array(await blob.arrayBuffer()), {
      headers: { 'x-root': encodeURIComponent(this.root), 'x-path': encodeURIComponent(path) },
    })
  }

  exists(path: string) {
    return call<boolean>('vault_exists', { root: this.root, path })
  }

  async remove(path: string) {
    await call('vault_remove', { root: this.root, path })
  }

  async move(from: string, to: string) {
    await call('vault_move', { root: this.root, from, to })
  }
}

// ---------- запомненная папка ----------

const settings = createStore('studynotes-settings', 'kv')
const PATH_KEY = 'vaultPath'

export const loadSavedPath = () => get<string>(PATH_KEY, settings).catch(() => undefined)
export const savePath = (path: string) => set(PATH_KEY, path, settings)
export const forgetPath = () => del(PATH_KEY, settings)

/** Системный диалог выбора папки. null — пользователь передумал. */
export async function pickFolderPath(): Promise<string | null> {
  const path = await open({ directory: true, title: 'Папка для конспектов' })
  return typeof path === 'string' ? path : null
}
