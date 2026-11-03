import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { create } from "zustand"
import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { errorText } from "@/lib/errors"
import { plural } from "@/lib/format"
import { toastUndo } from "@/lib/undo"
import { useVault } from "@/vault/store"

const useOpen = create<{ open: boolean; set: (v: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))

export const openClearSubjects = () => useOpen.getState().set(true)

export function ClearSubjectsDialog() {
  const open = useOpen((s) => s.open)
  const close = () => useOpen.getState().set(false)
  const subjects = useVault((s) => s.subjects)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const undo = await useVault.getState().trashSubjects(subjects.map((s) => s.id))
      close()
      navigate("/")
      toastUndo("Все предметы в корзине", undo)
    } catch (e) {
      toast.error("Не получилось", { description: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Удалить все предметы?</DialogTitle>
          <DialogDescription>
            {plural(subjects.length, ["предмет", "предмета", "предметов"])} со всеми конспектами, закрепом и проектами уйдут в корзину. Их
            можно вернуть в течение 30 дней.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 space-y-1 overflow-y-auto text-[14px]">
          {subjects.map((s) => (
            <li key={s.id} className="truncate text-muted-foreground">
              · {s.name}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button variant="destructive" disabled={busy || !subjects.length} onClick={run}>
            Удалить все
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
