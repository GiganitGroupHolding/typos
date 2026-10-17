import { useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'
import { importFiles } from './importFiles'

const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')

/** Перетащил файлы на предмет: .md — конспекты, остальное — в «Проекты». Возвращает обработчики и флаг подсветки. */
export function useFileDrop(subjectId?: string) {
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
      if (!subjectId || !hasFiles(e)) return
      e.preventDefault()
      await importFiles(subjectId, [...e.dataTransfer.files], navigate)
    },
  }
  return { over, handlers }
}
