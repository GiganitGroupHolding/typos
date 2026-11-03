export type EntryKind = "file" | "dir"

export interface Entry {
  name: string
  kind: EntryKind
}

export interface VaultAdapter {
  readonly kind: "browser" | "folder" | "remote" | "memory"

  readonly label: string
  list(dir: string): Promise<Entry[]>
  readText(path: string): Promise<string | null>
  writeText(path: string, text: string): Promise<void>
  readBlob(path: string): Promise<Blob | null>
  writeBlob(path: string, blob: Blob): Promise<void>
  exists(path: string): Promise<boolean>

  remove(path: string): Promise<void>

  move(from: string, to: string): Promise<void>
}

export const joinPath = (...parts: string[]) =>
  parts
    .flatMap((p) => p.split("/"))
    .filter(Boolean)
    .join("/")

export function storageLabel(adapter: VaultAdapter | null): string | null {
  if (adapter?.kind === "folder") return `папка «${adapter.label}»`
  if (adapter?.kind === "remote") return `сервер «${adapter.label}»`
  return null
}

export const dirname = (path: string) => path.split("/").slice(0, -1).join("/")
export const basename = (path: string) => path.split("/").pop() ?? ""

export function safeName(name: string, fallback = "Без названия"): string {
  const cleaned = name
    .normalize("NFC")
    // oxlint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80)
  return cleaned || fallback
}

export function fileTitle(fileName: string): string {
  const base = fileName.normalize("NFC").split(/[\\/]/).pop() ?? ""
  return base
    .replace(/\.[^.\s]{1,8}$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

export const fileExt = (fileName: string) => fileName.match(/\.([^.\s]{1,8})$/)?.[1].toLowerCase() ?? ""

export async function uniquePath(adapter: VaultAdapter, dir: string, base: string, ext: string, except?: string) {
  let candidate = joinPath(dir, `${base}${ext}`)
  for (let i = 2; candidate !== except && (await adapter.exists(candidate)); i++) {
    candidate = joinPath(dir, `${base} (${i})${ext}`)
  }
  return candidate
}
