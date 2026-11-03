import { constants, existsSync, promises as fs, statSync } from "node:fs"
import path from "node:path"

export class LocalFiles {
  readonly roots: string[]

  constructor(roots: string[]) {
    this.roots = roots.map((r) => path.resolve(r))
  }

  get enabled() {
    return this.roots.length > 0
  }

  async resolve(file: string): Promise<string> {
    if (!this.enabled) throw new Error("Чтение файлов с компьютера выключено. Передай текст напрямую или разреши папку: --files <папка>")
    if (!path.isAbsolute(file)) throw new Error(`Нужен полный путь к файлу: ${file}`)
    const real = await fs.realpath(file).catch(() => {
      throw new Error(`Нет такого файла: ${file}`)
    })
    for (const root of this.roots) {
      const rel = path.relative(await fs.realpath(root).catch(() => root), real)
      if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue

      if (rel.split(path.sep).some((part) => part.startsWith("."))) throw new Error(`Скрытые файлы и папки недоступны: ${file}`)
      return real
    }
    throw new Error(`Файл вне разрешённых папок (${this.roots.join(", ")}): ${file}. Перенеси его туда или передай текст напрямую`)
  }

  async read(file: string, max: number): Promise<Buffer> {
    const real = await this.resolve(file)

    const handle = await fs.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const st = await handle.stat()
      if (!st.isFile()) throw new Error(`Это не файл: ${file}`)
      if (st.size > max) throw new Error(`Файл больше ${Math.round(max / 1024 / 1024)} МБ`)
      return await handle.readFile()
    } finally {
      await handle.close()
    }
  }
}

export function localFilesFrom(argv: string[], env: NodeJS.ProcessEnv): LocalFiles {
  const roots = argv.flatMap((a, i) => (a === "--files" && argv[i + 1] ? [argv[i + 1]] : []))
  if (!roots.length && env.STUDYNOTES_FILES) roots.push(...env.STUDYNOTES_FILES.split(path.delimiter).filter(Boolean))
  for (const root of roots) if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Нет такой папки для --files: ${root}`)
  return new LocalFiles(roots)
}
