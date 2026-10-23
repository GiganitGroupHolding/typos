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

/**
 * Ключи сервера хранения, если vault — его папка. Под любым написанием: на macOS и Windows «.TYPOS-SERVER» — та же папка.
 * Держи в согласии с STATE_DIR и isStateDir в server/typos-server.mjs (сервер без зависимостей, импортировать оттуда нельзя)
 * и с is_state_dir в src-tauri/src/paths.rs.
 */
const isServerStateDir = (name: string) => name.toLowerCase().replace(/[. ]+$/, '') === '.typos-server'

export class NodeFsAdapter implements VaultAdapter {
  readonly kind = 'folder' as const
  readonly label: string
  readonly root: string
  private rootReal?: Promise<string>

  constructor(root: string) {
    this.root = path.resolve(root)
    this.label = path.basename(this.root)
  }

  /** Относительный путь vault («Физика/Конспекты/x.md») → абсолютный внутри корня. Проверяет только строку — на диске проверяет safe(). */
  abs(rel: string): string {
    const parts = rel.split('/').filter(Boolean)
    if (
      parts.some((p) => p === '.' || p === '..' || p.includes('\\') || p.includes(':') || p.includes('\0')) ||
      (parts.length && isServerStateDir(parts[0]))
    )
      throw new Error(`Недопустимый путь: ${rel}`)
    const p = path.resolve(this.root, ...parts)
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw new Error(`Путь вне хранилища: ${rel}`)
    return p
  }

  /** Настоящий путь (после symlink и junction) лежит в корне и не в служебной папке сервера хранения? */
  private async inside(real: string) {
    this.rootReal ??= fs.realpath(this.root).catch((e: unknown) => {
      this.rootReal = undefined
      throw e
    })
    const rel = path.relative(await this.rootReal, real)
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false
    return !(rel && isServerStateDir(rel.split(path.sep)[0]))
  }

  /**
   * abs() + проверка на диске: ссылка внутри vault не выведет за корень и не приведёт к ключам сервера хранения.
   * Несуществующий путь проверяется по ближайшей существующей папке над ним.
   */
  private async safe(rel: string): Promise<string> {
    const target = this.abs(rel)
    for (let probe = target; ; probe = path.dirname(probe)) {
      let real: string
      try {
        real = await fs.realpath(probe)
      } catch (e) {
        if (!isMissing(e)) throw e
        // битая ссылка: цели нет, но сама ссылка есть — запись или mkdir по ней ушли бы наружу
        if (
          await fs.lstat(probe).then(
            () => true,
            () => false,
          )
        )
          throw new Error(`Путь вне хранилища: ${rel}`)
        if (probe === this.root) throw e
        continue
      }
      if (!(await this.inside(real))) throw new Error(`Путь вне хранилища: ${rel}`)
      return target
    }
  }

  async list(dir: string): Promise<Entry[]> {
    try {
      const abs = await this.safe(dir)
      const atRoot = abs === this.root
      const out: Entry[] = []
      for (const d of await fs.readdir(abs, { withFileTypes: true })) {
        if (atRoot && isServerStateDir(d.name)) continue
        let isDir = d.isDirectory()
        if (d.isSymbolicLink()) {
          // ссылку наружу не показываем: прочитать по ней всё равно нельзя
          const real = await fs.realpath(path.join(abs, d.name)).catch(() => null)
          if (!real || !(await this.inside(real))) continue
          isDir = (await fs.stat(real)).isDirectory()
        }
        out.push({ name: d.name, kind: isDir ? 'dir' : 'file' })
      }
      return out
    } catch (e) {
      if (isMissing(e)) return []
      throw e
    }
  }

  async readText(p: string) {
    try {
      return await fs.readFile(await this.safe(p), 'utf8')
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async readBlob(p: string) {
    try {
      return new Blob([await fs.readFile(await this.safe(p))])
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  /** Пишет во временный файл и переименовывает — приложение не прочитает файл наполовину. */
  private async writeBuffer(p: string, data: Buffer | string) {
    const target = await this.safe(p)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await fs.writeFile(tmp, data, { flag: 'wx' })
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
      await fs.access(await this.safe(p))
      return true
    } catch {
      return false
    }
  }

  async remove(p: string) {
    await fs.rm(await this.safe(p), { recursive: true, force: true })
  }

  async move(from: string, to: string) {
    if (from === to) return
    const [src, dst] = [await this.safe(from), await this.safe(to)]
    if (await this.exists(to)) throw new Error(`Уже существует: ${to}`)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.rename(src, dst)
  }
}
