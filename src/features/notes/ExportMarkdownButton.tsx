import { Download } from "lucide-react"
import { Button } from "@/components/ui/Button"
import type { Note } from "@/types"
import { exportMarkdown } from "./exportMarkdown"

export function ExportMarkdownButton({ note, getMarkdown }: { note: Note; getMarkdown?: () => string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Скачать Markdown"
      title="Скачать Markdown (.md)"
      onClick={() => exportMarkdown(note, getMarkdown?.())}
    >
      <Download />
    </Button>
  )
}
