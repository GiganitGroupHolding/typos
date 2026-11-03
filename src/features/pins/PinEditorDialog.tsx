import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { create } from "zustand"
import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { errorText } from "@/lib/errors"
import { submitOnCtrlEnter } from "@/lib/forms"
import { Tex } from "@/lib/Tex"
import { useVault } from "@/vault/store"

interface Target {
  subjectId: string

  pinId?: string

  tex?: string
  title?: string
  text?: string
}

const useTarget = create<{ target: Target | null; set: (t: Target | null) => void }>((set) => ({
  target: null,
  set: (target) => set({ target }),
}))

export const openPinEditor = (t: Target) => useTarget.getState().set(t)

export function PinEditorDialog() {
  const target = useTarget((s) => s.target)
  const close = () => useTarget.getState().set(null)
  const pin = useVault((s) => s.pins.find((p) => p.id === target?.pinId))
  const [title, setTitle] = useState("")
  const [tex, setTex] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) return
    setTitle(pin?.title ?? target.title ?? "")
    setTex(pin?.tex ?? target.tex ?? "")
    setText(pin?.text ?? target.text ?? "")
  }, [target, pin])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!target || !title.trim()) return
    setBusy(true)
    try {
      const v = useVault.getState()
      if (pin) await v.updatePin(pin.id, { title, tex, text })
      else {
        await v.createPin(target.subjectId, { title, tex, text })
        toast.success("Закреплено", { description: title.trim() })
      }
      close()
    } catch (err) {
      toast.error("Не удалось сохранить карточку", { description: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && close()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <form onSubmit={submit} onKeyDown={submitOnCtrlEnter} className="contents">
          <DialogHeader>
            <DialogTitle>{pin ? "Карточка закрепа" : "Новая карточка"}</DialogTitle>
          </DialogHeader>

          <div>
            <label htmlFor="pin-title" className="mb-1 block text-[13px] font-medium">
              Название
            </label>
            <Input
              id="pin-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Формула Крамера"
              maxLength={80}
            />
          </div>

          <div>
            <label htmlFor="pin-tex" className="mb-1 block text-[13px] font-medium">
              Формула LaTeX
            </label>
            <textarea
              id="pin-tex"
              value={tex}
              onChange={(e) => setTex(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="x_i = \frac{\det A_i}{\det A}"
              className="w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div aria-live="polite" className="thin-scrollbar mt-2 min-h-12 overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 text-center">
              {tex.trim() ? <Tex tex={tex} block /> : <span className="text-[12px] text-muted-foreground">Превью формулы</span>}
            </div>
          </div>

          <div>
            <label htmlFor="pin-text" className="mb-1 block text-[13px] font-medium">
              Пояснение
            </label>
            <textarea
              id="pin-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="det A ≠ 0"
              className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              {pin ? "Сохранить" : "Закрепить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
