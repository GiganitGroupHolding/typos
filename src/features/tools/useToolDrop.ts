import { useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorText } from '@/lib/undo'
import { importHtmlFile } from './ToolDialog'

const htmlFiles = (e: DragEvent) => [...e.dataTransfer.files].filter((f) => /\.html?$/i.test(f.name) || f.type === 'text/html')
const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')

/** Перетащил .html на предмет — тулза добавлена. Возвращает обработчики и флаг подсветки. */
export function useToolDrop(subjectId?: string) {
  const [over, setOver] = useState(false)
  const navigate = useNavigate()

  const handlers = {
    onDragOver: (e: DragEvent) => {
      if (!subjectId || !hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setOver(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setOver(false)
    },
    onDrop: async (e: DragEvent) => {
      setOver(false)
      if (!subjectId) return
      const files = htmlFiles(e)
      if (!files.length) return
      e.preventDefault()
      for (const f of files) {
        try {
          const t = await importHtmlFile(subjectId, f)
          toast.success(`Тулза «${t.name}» добавлена`, {
            action: { label: 'Открыть', onClick: () => navigate(`/s/${t.subjectId}/t/${t.id}`) },
          })
        } catch (err) {
          toast.error(`Не удалось добавить ${f.name}`, { description: errorText(err) })
        }
      }
    },
  }
  return { over, handlers }
}
