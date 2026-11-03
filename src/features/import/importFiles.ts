import { toast } from "sonner"
import { importHtmlFile } from "@/features/tools/ToolDialog"
import { errorText } from "@/lib/errors"
import { isImageFile, isMarkdownFile, pickFiles } from "@/lib/files"
import { plural } from "@/lib/format"
import type { Tool } from "@/types"
import { useVault } from "@/vault/store"

type Go = (to: string) => void

const isHtmlFile = (f: File) => /\.html?$/i.test(f.name) || f.type === "text/html"

export async function importFiles(subjectId: string, files: File[], go: Go) {
  const md = files.filter(isMarkdownFile)
  if (md.length) {
    try {
      const notes = await useVault.getState().importNotes(subjectId, files)
      if (notes.length === 1) {
        const n = notes[0]
        toast.success(`Конспект «${n.title}» добавлен`, { action: { label: "Открыть", onClick: () => go(`/s/${n.subjectId}/n/${n.id}`) } })
      } else {
        toast.success(`Добавлено ${plural(notes.length, ["конспект", "конспекта", "конспектов"])}`)
      }
    } catch (err) {
      toast.error("Не удалось импортировать конспекты", { description: errorText(err) })
    }
  }

  const rest = files.filter((f) => !isMarkdownFile(f) && !(md.length && isImageFile(f)))
  const added: Tool[] = []
  for (const f of rest) {
    try {
      added.push(
        isHtmlFile(f)
          ? await importHtmlFile(subjectId, f)
          : await useVault.getState().importProjectFile(subjectId, { name: f.name, blob: f }),
      )
    } catch (err) {
      toast.error(`Не удалось добавить «${f.name}»`, { description: errorText(err) })
    }
  }
  if (added.length === 1) {
    const t = added[0]
    toast.success(`«${t.name}» в проектах`, { action: { label: "Открыть", onClick: () => go(`/s/${t.subjectId}/t/${t.id}`) } })
  } else if (added.length > 1) {
    toast.success(`В проекты добавлено ${plural(added.length, ["файл", "файла", "файлов"])}`, {
      action: { label: "Показать", onClick: () => go(`/s/${subjectId}?tab=tools`) },
    })
  }
}

export async function pickAndImportNotes(subjectId: string, go: Go) {
  const files = await pickFiles(".md,.markdown,.txt,text/markdown,image/*")
  if (files.length) await importFiles(subjectId, files, go)
}
