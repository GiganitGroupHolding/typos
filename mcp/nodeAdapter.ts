import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Entry, VaultAdapter } from '@/storage/VaultAdapter'

/**
 * Папка vault на диске для Node (MCP-сервер). Тот же интерфейс, что у приложения,
 * поэтому repo.ts пишет файлы ровно так же, как само приложение.
 * Выйти за корень нельзя: «..», абсолютные пути и ссылки наружу отклоняются.
 */

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

export class NodeFsAdapter implements VaultAdapter {
  readonly kind = 'folder' as const
  readonly label: string
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
    this.label = path.basename(this.root)
  }

  /** Относительный путь vault («Физика/Конспекты/x.md») → абсолютный внутри корня. */
  abs(rel: string): string {
    const parts = rel.split('/').filter(Boolean)
    if (parts.some((p) => p === '..' || p.includes('\\') || p.includes(':'))) throw new Error(`Недопустимый путь: ${rel}`)
    const p = path.resolve(this.root, ...parts)
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw new Error(`Путь вне хранилища: ${rel}`)
    return p
  }

  async list(dir: string): Promise<Entry[]> {
    try {
      const items = await fs.readdir(this.abs(dir), { withFileTypes: true })
      return items.map((d) => ({ name: d.name, kind: d.isDirectory() ? 'dir' : 'file' }))
    } catch (e) {
      if (isMissing(e)) return []
      throw e
    }
  }

  async readText(p: string) {
    try {
      return await fs.readFile(this.abs(p), 'utf8')
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async readBlob(p: string) {
    try {
      return new Blob([await fs.readFile(this.abs(p))])
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  /** Пишет во временный файл и переименовывает — приложение не прочитает файл наполовину. */
  private async writeBuffer(p: string, data: Buffer | string) {
    const target = this.abs(p)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, target)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw e
    }
  }

  writeText(p: string, text: string) {
    return this.writeBuffer(p, text)
  }

  async writeBlob(p: string, blob: Blob) {
    await this.writeBuffer(p, Buffer.from(await blob.arrayBuffer()))
  }

  async exists(p: string) {
    try {
      await fs.access(this.abs(p))
      return true
    } catch {
      return false
    }
  }

  async remove(p: string) {
    await fs.rm(this.abs(p), { recursive: true, force: true })
  }

  async move(from: string, to: string) {
    if (from === to) return
    if (await this.exists(to)) throw new Error(`Уже существует: ${to}`)
    await fs.mkdir(path.dirname(this.abs(to)), { recursive: true })
    await fs.rename(this.abs(from), this.abs(to))
  }
}
