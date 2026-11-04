import { motion } from "motion/react"
import { useId, useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { create } from "zustand"
import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { subjectIcons } from "@/features/subjects/visuals"
import { errorText } from "@/lib/errors"
import { submitOnCtrlEnter } from "@/lib/forms"
import { dur, easeOut } from "@/lib/motion"
import { isQuizPin, pinUrl } from "@/lib/pins"
import { SUBJECT_ICONS } from "@/lib/subjectPalette"
import { Tex } from "@/lib/Tex"
import { cn } from "@/lib/utils"
import type { Pin } from "@/types"
import { useVault } from "@/vault/store"
import { PinLinkIcon } from "./PinCard"

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
const close = () => useTarget.getState().set(null)

export function PinEditorDialog() {
  const target = useTarget((s) => s.target)
  const pin = useVault((s) => s.pins.find((p) => p.id === target?.pinId))
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent
        surface="liquid"
        aria-describedby={undefined}
        className="flex h-[min(640px,90dvh)] flex-col overflow-hidden sm:max-w-lg"
      >
        {target && <PinForm key={`${target.pinId ?? "new"}-${target.subjectId}`} target={target} pin={pin} />}
      </DialogContent>
    </Dialog>
  )
}

const pinModes = [
  { id: "text", label: "Текст" },
  { id: "formula", label: "Формула" },
  { id: "link", label: "Ссылка" },
] as const
type PinMode = (typeof pinModes)[number]["id"]

function PinForm({ target, pin }: { target: Target; pin?: Pin }) {
  const [title, setTitle] = useState(pin?.title ?? target.title ?? "")
  const [tex, setTex] = useState(pin?.tex ?? target.tex ?? "")
  const [text, setText] = useState(pin?.text ?? target.text ?? "")
  const [mode, setMode] = useState<PinMode>(
    pin?.kind === "link" ? "link" : pin?.kind === "formula" || pin?.tex || target.tex ? "formula" : "text",
  )
  const tabId = useId()
  const link = mode === "link"
  const [url, setUrl] = useState(pin?.url ?? "")
  const [icon, setIcon] = useState<Pin["icon"]>(pin?.icon ?? "favicon")
  const [quiz, setQuiz] = useState(pin ? isQuizPin(pin) : true)
  const [busy, setBusy] = useState(false)
  const validUrl = pinUrl(url)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || (link && !validUrl)) return
    setBusy(true)
    try {
      const input = {
        title,
        tex: mode === "formula" ? tex : "",
        text: link ? "" : text,
        kind: link ? ("link" as const) : mode === "formula" ? ("formula" as const) : ("content" as const),
        quiz: mode === "formula" && quiz,
        url: link ? validUrl : undefined,
        icon,
      }
      const vault = useVault.getState()
      if (pin) await vault.updatePin(pin.id, input)
      else {
        await vault.createPin(target.subjectId, input)
        toast.success("Закреплено", { description: title.trim() })
      }
      close()
    } catch (error) {
      toast.error("Не удалось сохранить закреп", { description: errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} onKeyDown={submitOnCtrlEnter} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogHeader className="shrink-0">
        <DialogTitle>{pin ? "Изменить закреп" : "Новый закреп"}</DialogTitle>
      </DialogHeader>
      <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div role="tablist" aria-label="Вид закрепа" className="relative isolate flex rounded-full bg-foreground/5 p-1">
          <motion.span
            aria-hidden
            initial={false}
            animate={{ x: `${pinModes.findIndex((item) => item.id === mode) * 100}%` }}
            transition={{ duration: dur.base, ease: easeOut }}
            style={{ width: "calc((100% - 8px) / 3)" }}
            className="liquid-active pointer-events-none absolute top-1 bottom-1 left-1 rounded-full will-change-transform"
          />
          {pinModes.map((item, index) => (
            <motion.button
              key={item.id}
              type="button"
              role="tab"
              id={`${tabId}-${item.id}`}
              aria-selected={mode === item.id}
              aria-controls={`${tabId}-panel-${item.id}`}
              tabIndex={mode === item.id ? 0 : -1}
              onClick={() => setMode(item.id)}
              whileTap={{ scale: 0.96 }}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % pinModes.length
                    : event.key === "ArrowLeft"
                      ? (index + pinModes.length - 1) % pinModes.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? pinModes.length - 1
                          : undefined
                if (next === undefined) return
                event.preventDefault()
                setMode(pinModes[next].id)
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
              }}
              className={cn(
                "relative flex-1 rounded-full px-3 py-2 text-[13px] font-semibold outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring",
                mode === item.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="relative z-10">{item.label}</span>
            </motion.button>
          ))}
        </div>
        <div>
          <label htmlFor="pin-title" className="mb-1 block text-[13px] font-medium">
            Название
          </label>
          <Input
            id="pin-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={link ? "Полезный сайт" : "Что важно запомнить"}
            maxLength={120}
          />
        </div>
        <AnimatedPinFields mode={mode} tabId={tabId}>
          {link ? (
            <>
              <div>
                <label htmlFor="pin-url" className="mb-1 block text-[13px] font-medium">
                  Адрес ссылки
                </label>
                <Input
                  id="pin-url"
                  inputMode="url"
                  autoComplete="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  aria-invalid={!!url.trim() && !validUrl}
                />
                {!!url.trim() && !validUrl && (
                  <p className="mt-1 text-[12px] text-destructive">Вставь ссылку на сайт: https://example.com.</p>
                )}
              </div>
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium">Иконка</legend>
                <label className="mb-3 flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={icon === "favicon"}
                    onChange={(e) => setIcon(e.target.checked ? "favicon" : "globe")}
                    className="size-4 accent-highlight"
                  />{" "}
                  Иконка сайта
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SUBJECT_ICONS.map(({ id, label }) => {
                    const Icon = subjectIcons[id]
                    return (
                      <motion.button
                        key={id}
                        whileTap={{ scale: 0.9 }}
                        type="button"
                        aria-label={label}
                        title={label}
                        aria-pressed={icon === id}
                        onClick={() => setIcon(id)}
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          icon === id ? "border-highlight bg-accent text-highlight" : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <Icon className="size-4" />
                      </motion.button>
                    )
                  })}
                </div>
              </fieldset>
              <div className="flex items-center gap-3 rounded-xl border px-3 py-3">
                <PinLinkIcon icon={icon} url={validUrl} />
                <span className="min-w-0 break-words text-[14px] font-semibold">{title.trim() || "Название ссылки"}</span>
              </div>
            </>
          ) : (
            <>
              {mode === "formula" && (
                <>
                  <div>
                    <label htmlFor="pin-tex" className="mb-1 block text-[13px] font-medium">
                      LaTeX
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
                    <div
                      aria-live="polite"
                      className="thin-scrollbar mt-2 min-h-12 overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 text-center"
                    >
                      {tex.trim() ? <Tex tex={tex} block /> : <span className="text-[12px] text-muted-foreground">Предпросмотр LaTeX</span>}
                    </div>
                  </div>
                </>
              )}
              <div>
                <label htmlFor={`pin-text-${mode}`} className="mb-1 block text-[13px] font-medium">
                  Пояснение
                </label>
                <textarea
                  id={`pin-text-${mode}`}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={mode === "text" ? 4 : 2}
                  placeholder={
                    mode === "formula" ? "Что означает формула и когда её применять" : "Определение, памятка, полезная информация…"
                  }
                  className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              {mode === "formula" && (
                <>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={quiz} onChange={(e) => setQuiz(e.target.checked)} className="size-4 accent-highlight" />{" "}
                    Включать в викторину
                  </label>
                </>
              )}
            </>
          )}
        </AnimatedPinFields>
      </div>
      <DialogFooter className="shrink-0 bg-transparent">
        <Button type="button" variant="ghost" onClick={close}>
          Отмена
        </Button>
        <Button type="submit" disabled={!title.trim() || (link && !validUrl) || busy}>
          {pin ? "Сохранить" : "Закрепить"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function AnimatedPinFields({ mode, tabId, children }: { mode: PinMode; tabId: string; children: ReactNode }) {
  return (
    <motion.div
      key={mode}
      role="tabpanel"
      id={`${tabId}-panel-${mode}`}
      aria-labelledby={`${tabId}-${mode}`}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.fast, ease: easeOut }}
      className="space-y-4 p-0.5"
    >
      {children}
    </motion.div>
  )
}
