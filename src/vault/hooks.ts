import { useCallback } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { errorText } from "@/lib/errors"
import { templates, type TemplateId } from "@/lib/templates"
import { useVault } from "./store"

const byUpdated = <T extends { updated: string }>(a: T, b: T) => b.updated.localeCompare(a.updated)

export const useSubjects = () => useVault((s) => s.subjects)
export const useSubject = (id?: string) => useVault((s) => s.subjects.find((x) => x.id === id))
export const useNote = (id?: string) => useVault((s) => s.notes.find((x) => x.id === id))
export const useTool = (id?: string) => useVault((s) => s.tools.find((x) => x.id === id))
export const usePin = (id?: string) => useVault((s) => s.pins.find((x) => x.id === id))
export const useBoard = (id?: string) => useVault((s) => s.boards.find((x) => x.id === id))

export const useNotesOf = (subjectId?: string) =>
  useVault(useShallow((s) => s.notes.filter((n) => n.subjectId === subjectId).sort(byUpdated)))
export const usePinsOf = (subjectId?: string) => useVault(useShallow((s) => s.pins.filter((p) => p.subjectId === subjectId)))
export const useToolsOf = (subjectId?: string) => useVault(useShallow((s) => s.tools.filter((t) => t.subjectId === subjectId)))
export const useBoardsOf = (subjectId?: string) => useVault(useShallow((s) => s.boards.filter((b) => b.subjectId === subjectId)))
export const useRecentNotes = (limit = 5) => useVault(useShallow((s) => [...s.notes].sort(byUpdated).slice(0, limit)))

export function useCreateNote() {
  const navigate = useNavigate()
  return useCallback(
    async (subjectId?: string, template: TemplateId = "blank") => {
      const { subjects, createNote } = useVault.getState()
      const target = subjectId ?? subjects[0]?.id
      if (!target) {
        toast("Сначала создай предмет")
        return
      }
      try {
        const note = await createNote(target, templates.find((t) => t.id === template)?.body())
        navigate(`/s/${target}/n/${note.id}?new=1`)
      } catch (e) {
        toast.error("Не удалось создать конспект", { description: errorText(e) })
      }
    },
    [navigate],
  )
}

export function useCreateBoard() {
  const navigate = useNavigate()
  return useCallback(
    async (subjectId: string) => {
      try {
        const board = await useVault.getState().createBoard(subjectId)
        navigate(`/s/${subjectId}/b/${board.id}?new=1`)
      } catch (e) {
        toast.error("Не удалось создать доску", { description: errorText(e) })
      }
    },
    [navigate],
  )
}
