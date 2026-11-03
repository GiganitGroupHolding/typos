import { downloadBlob } from "@/lib/download"
import { basename } from "@/storage/VaultAdapter"
import type { Note } from "@/types"

export function exportMarkdown(note: Pick<Note, "path" | "body">, markdown = note.body) {
  downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), basename(note.path))
}
