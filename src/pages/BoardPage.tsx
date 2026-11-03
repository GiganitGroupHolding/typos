import { LayoutDashboard } from "lucide-react"
import { motion } from "motion/react"
import { useEffect, useRef } from "react"
import { Navigate, useParams, useSearchParams } from "react-router"
import { toast } from "sonner"
import { BoardActions } from "@/features/boards/BoardActions"
import { BoardCanvas } from "@/features/boards/BoardCanvas"
import { errorText } from "@/lib/errors"
import { pageEnter } from "@/lib/motion"
import type { Board } from "@/types"
import { useBoard, useSubject } from "@/vault/hooks"
import { useVault } from "@/vault/store"

export function BoardPage() {
  const { subjectId, boardId } = useParams()
  const board = useBoard(boardId)
  const subject = useSubject(subjectId)
  if (!board || !subject || board.subjectId !== subject.id) return <Navigate to={subject ? `/s/${subject.id}?tab=boards` : "/"} replace />

  return (
    <motion.div {...pageEnter} key={board.id} className="flex h-full flex-col p-3 pt-2">
      <div className="mb-2 flex items-center gap-2 px-1">
        <LayoutDashboard className="size-4 shrink-0 text-highlight" />
        <BoardTitle key={`${board.id}:${board.name}`} board={board} />
        <BoardActions board={board} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border bg-background shadow-card">
        <BoardCanvas key={board.id} board={board} />
      </div>
    </motion.div>
  )
}

function BoardTitle({ board }: { board: Board }) {
  const ref = useRef<HTMLInputElement>(null)
  const [params, setParams] = useSearchParams()
  const focus = params.has("new") || params.has("rename")

  useEffect(() => {
    if (!focus) return
    ref.current?.focus()
    ref.current?.select()
    setParams({}, { replace: true })
  }, [focus, setParams])

  const save = async (el: HTMLInputElement) => {
    const name = el.value.trim()
    if (!name || name === board.name) {
      el.value = board.name
      return
    }
    try {
      await useVault.getState().renameBoard(board.id, name)
    } catch (e) {
      el.value = board.name
      toast.error("Не удалось переименовать доску", { description: errorText(e) })
    }
  }

  return (
    <input
      ref={ref}
      defaultValue={board.name}
      aria-label="Название доски"
      onBlur={(e) => void save(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== "Escape") return
        if (e.key === "Escape") e.currentTarget.value = board.name

        document.querySelector<HTMLElement>("[data-board-canvas]")?.focus({ preventScroll: true })
      }}
      className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}
