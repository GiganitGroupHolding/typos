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

export const dirname = (path: string) => path.split('/').slice(0, -1).join('/')
export const basename = (path: string) => path.split('/').pop() ?? ''

/** Убирает запрещённые в Windows символы и лишние пробелы. */
export function safeName(name: string, fallback = 'Без названия'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return cleaned || fallback
}

/** «Имя.md» → «Имя (2).md», пока путь занят. */
export async function uniquePath(adapter: VaultAdapter, dir: string, base: string, ext: string, except?: string) {
  let candidate = joinPath(dir, `${base}${ext}`)
  for (let i = 2; candidate !== except && (await adapter.exists(candidate)); i++) {
    candidate = joinPath(dir, `${base} (${i})${ext}`)
  }
  return candidate
}
