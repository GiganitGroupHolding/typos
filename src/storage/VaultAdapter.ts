/**
 * Единственная точка доступа к файлам vault.
 * Пути относительные, разделитель «/», без ведущего слэша: «Физика/Конспекты/Кинематика.md».
 * Реализации: браузер (IndexedDB), папка на диске (File System Access), сервер хранения (remoteAdapter), память (тесты).
 */

export type EntryKind = 'file' | 'dir'

export interface Entry {
  name: string
  kind: EntryKind
}

export interface VaultAdapter {
  readonly kind: 'browser' | 'folder' | 'remote' | 'memory'
  /** Человекочитаемое имя хранилища (имя папки или «Браузер»). */
  readonly label: string
  list(dir: string): Promise<Entry[]>
  readText(path: string): Promise<string | null>
  writeText(path: string, text: string): Promise<void>
  readBlob(path: string): Promise<Blob | null>
  writeBlob(path: string, blob: Blob): Promise<void>
  exists(path: string): Promise<boolean>
  /** Удаляет файл или папку целиком. */
  remove(path: string): Promise<void>
  /** Перемещает файл или папку. Цель не должна существовать. */
  move(from: string, to: string): Promise<void>
}

export const joinPath = (...parts: string[]) =>
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/')

/** Где лежат конспекты, для подписей: «папка «Учёба»», «сервер «Дом»»; null — хранилище браузера. */
export function storageLabel(adapter: VaultAdapter | null): string | null {
  if (adapter?.kind === 'folder') return `папка «${adapter.label}»`
  if (adapter?.kind === 'remote') return `сервер «${adapter.label}»`
  return null
}

export const dirname = (path: string) => path.split('/').slice(0, -1).join('/')
export const basename = (path: string) => path.split('/').pop() ?? ''

/**
 * Имя для файла: кириллица, пробелы и знаки остаются, убираются только запрещённые в Windows
 * символы и лишние пробелы. NFC — имена из macOS приходят разложенными («й» = «и» + знак).
 */
export function safeName(name: string, fallback = 'Без названия'): string {
  const cleaned = name
    .normalize('NFC')
    // oxlint-disable-next-line no-control-regex -- управляющие символы и надо вырезать
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return cleaned || fallback
}

/** Название из имени файла: без расширения и пути, в NFC, кириллица и пробелы как есть. */
export function fileTitle(fileName: string): string {
  const base = fileName.normalize('NFC').split(/[\\/]/).pop() ?? ''
  return base
    .replace(/\.[^.\s]{1,8}$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Расширение в нижнем регистре без точки: «Лекция 1.PDF» → «pdf». */
export const fileExt = (fileName: string) => fileName.match(/\.([^.\s]{1,8})$/)?.[1].toLowerCase() ?? ''

/** «Имя.md» → «Имя (2).md», пока путь занят. */
export async function uniquePath(adapter: VaultAdapter, dir: string, base: string, ext: string, except?: string) {
  let candidate = joinPath(dir, `${base}${ext}`)
  for (let i = 2; candidate !== except && (await adapter.exists(candidate)); i++) {
    candidate = joinPath(dir, `${base} (${i})${ext}`)
  }
  return candidate
}
