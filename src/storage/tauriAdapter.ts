import { invoke } from '@tauri-apps/api/core'
import type { Entry, VaultAdapter } from './VaultAdapter'

/**
 * Папка на диске в десктопном приложении (Tauri): файлы читает и пишет Rust (src-tauri/src/vault.rs).
 * Папку выбирают в системном диалоге; Rust запоминает её сам и пускает только в выбранные папки.
 */

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

// ---------- выбор и запомненная папка ----------

/** Папка, выбранная в прошлый раз; null — не выбирали. */
export const loadSavedPath = () => call<string | null>('vault_saved')
/** Системный диалог выбора папки. null — пользователь передумал. */
export const pickFolderPath = () => call<string | null>('vault_pick')
export const savePath = (root: string) => call<void>('vault_remember', { root })
export const forgetPath = () => call<void>('vault_forget')
