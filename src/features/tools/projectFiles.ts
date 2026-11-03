import { toast } from "sonner"
import { downloadBlob } from "@/lib/download"
import { errorText } from "@/lib/errors"
import { basename } from "@/storage/VaultAdapter"
import type { Tool } from "@/types"
import { useVault } from "@/vault/store"

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
}

export async function readProjectBlob(path: string, ext: string): Promise<Blob> {
  const blob = await useVault.getState().adapter?.readBlob(path)
  if (!blob) throw new Error("Файла нет на месте: возможно, его переместили или удалили в проводнике")
  return blob.slice(0, blob.size, MIME[ext] ?? (blob.type || "application/octet-stream"))
}

export async function downloadProjectFile(tool: Tool) {
  try {
    downloadBlob(await readProjectBlob(tool.path, tool.ext), basename(tool.path))
  } catch (err) {
    toast.error("Не удалось скачать", { description: errorText(err) })
  }
}
