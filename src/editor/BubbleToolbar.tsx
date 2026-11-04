import { NodeSelection } from "@tiptap/pm/state"
import { useEditorState, type Editor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import {
  Baseline,
  Bold,
  Check,
  ChevronDown,
  Code,
  Italic,
  Link2,
  Link2Off,
  Pin,
  Radical,
  Strikethrough,
  Underline,
  type LucideIcon,
} from "lucide-react"
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type HTMLMotionProps, type MotionValue } from "motion/react"
import { createContext, useContext, useEffect, useRef, useState, type MouseEvent } from "react"
import { useLiquidLens } from "@/components/ui/LiquidLens"
import { cn } from "@/lib/utils"
import { COLOR_LABELS, NOTE_COLORS, type NoteColor } from "./colors"

type Panel = "turn" | "color" | "link" | null

const BLOCKS = [
  { id: "paragraph", label: "Текст" },
  { id: "h1", label: "Заголовок 1" },
  { id: "h2", label: "Заголовок 2" },
  { id: "h3", label: "Заголовок 3" },
  { id: "bullet", label: "Маркированный список" },
  { id: "ordered", label: "Нумерованный список" },
  { id: "task", label: "Чек-лист" },
  { id: "quote", label: "Цитата" },
  { id: "code", label: "Код" },
  { id: "math", label: "Формула" },
] as const
type BlockId = (typeof BLOCKS)[number]["id"]

function currentBlock(e: Editor): BlockId {
  if (e.isActive("codeBlock")) return "code"
  if (e.isActive("taskList")) return "task"
  if (e.isActive("orderedList")) return "ordered"
  if (e.isActive("bulletList")) return "bullet"
  if (e.isActive("blockquote")) return "quote"
  for (const level of [1, 2, 3] as const) if (e.isActive("heading", { level })) return `h${level}`
  return "paragraph"
}

function turnInto(e: Editor, id: BlockId) {
  const c = e.chain().focus()

  if (id === "paragraph") return c.clearNodes().setParagraph().run()
  if (id === "h1" || id === "h2" || id === "h3")
    return c
      .clearNodes()
      .setHeading({ level: Number(id[1]) as 1 | 2 | 3 })
      .run()
  if (id === "bullet") return c.clearNodes().toggleBulletList().run()
  if (id === "ordered") return c.clearNodes().toggleOrderedList().run()
  if (id === "task") return c.clearNodes().toggleTaskList().run()
  if (id === "quote") return c.clearNodes().toggleBlockquote().run()
  if (id === "code") return c.clearNodes().toggleCodeBlock().run()

  const { $from } = e.state.selection
  const latex = $from.parent.textContent.trim().replace(/^(?:\$\$|\\\[)\s*([\s\S]*?)\s*(?:\$\$|\\\])$/, "$1")
  const depth = $from.depth
  return c
    .command(({ tr, state }) => {
      tr.replaceWith($from.before(depth), $from.after(depth), state.schema.nodes.blockMath.create({ latex }))
      return true
    })
    .run()
}

const keep = (e: MouseEvent) => e.preventDefault()

const ToolbarMouse = createContext<MotionValue<number> | null>(null)

function ToolbarButton(props: HTMLMotionProps<"button">) {
  const ref = useRef<HTMLButtonElement>(null)
  const idleMouse = useMotionValue(Infinity)
  const mouseX = useContext(ToolbarMouse) ?? idleMouse
  const distance = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || !Number.isFinite(x)) return Infinity
    return x - (r.left + r.width / 2)
  })
  const scale = useSpring(useTransform(distance, [-90, 0, 90], [1, 1.22, 1], { clamp: true }), { stiffness: 420, damping: 30, mass: 0.5 })
  const y = useTransform(scale, (s) => -(s - 1) * 16)

  return <motion.button {...props} ref={ref} style={{ ...props.style, scale, y }} whileTap={{ scale: 0.9 }} />
}

function Btn({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
  className,
}: {
  icon: LucideIcon
  label: string
  shortcut?: string
  active?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <ToolbarButton
      type="button"
      title={shortcut ? `${label}\n${shortcut}` : label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={keep}
      onClick={onClick}
      className={cn(
        "flex size-8 origin-bottom items-center justify-center rounded-xl outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring",
        active ? "liquid-active" : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
    </ToolbarButton>
  )
}

const Sep = () => <div aria-hidden className="mx-0.5 h-5 w-px bg-border" />

export function BubbleToolbar({
  editor,
  linkRequest,
  onFormula,
  onPin,
}: {
  editor: Editor

  linkRequest: number
  onFormula: () => void
  onPin: (text: string) => void
}) {
  const [panel, setPanel] = useState<Panel>(null)
  const mouseX = useMotionValue(Infinity)
  const lens = useLiquidLens({ fallback: "liquid liquid-lava" })
  const [url, setUrl] = useState("")
  const linkInput = useRef<HTMLInputElement>(null)

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      textColor: (e.getAttributes("textColor").color as NoteColor | undefined) ?? null,
      bgColor: (e.isActive("highlight") ? ((e.getAttributes("highlight").color as NoteColor | undefined) ?? "default") : null) as
        NoteColor | "default" | null,
      block: currentBlock(e),
    }),
  })

  useEffect(() => {
    if (!linkRequest) return
    setUrl(editor.getAttributes("link").href ?? "")
    setPanel("link")
  }, [linkRequest, editor])
  useEffect(() => {
    if (panel === "link") requestAnimationFrame(() => linkInput.current?.focus())
  }, [panel])

  const c = () => editor.chain().focus()
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p))
  const remember = (kind: "text" | "bg", color: NoteColor) => (editor.storage.lastColor.last = { kind, color })

  const applyLink = () => {
    const href = url.trim()
    if (!href) c().extendMarkRange("link").unsetLink().run()
    else
      c()
        .extendMarkRange("link")
        .setLink({ href: /^[a-z][\w+.-]*:/i.test(href) ? href : `https://${href}` })
        .run()
    setPanel(null)
  }

  const selectionText = () => {
    const { from, to } = editor.state.selection
    return editor.state.doc.textBetween(from, to, " ").trim()
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 10, flip: true, shift: { padding: 12 }, onHide: () => setPanel(null) }}
      shouldShow={({ editor: e, state, from, to }) => {
        if (!e.isEditable || from === to) return false
        if (state.selection instanceof NodeSelection) return false
        return true
      }}
      className="z-40"
    >
      <motion.div
        initial={{ opacity: 0, y: 4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 34 }}
        className="relative"
      >
        <div
          role="toolbar"
          aria-label="Форматирование выделенного"
          onPointerMove={(e) => e.pointerType === "mouse" && mouseX.set(e.clientX)}
          onPointerLeave={() => mouseX.set(Infinity)}
          style={{
            background: "linear-gradient(rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.5)), linear-gradient(var(--lens-tint), var(--lens-tint))",
          }}
          className={cn(lens.className, "flex items-center gap-0.5 rounded-2xl p-1")}
        >
          <ToolbarMouse.Provider value={mouseX}>
            <ToolbarButton
              type="button"
              onMouseDown={keep}
              onClick={() => toggle("turn")}
              aria-expanded={panel === "turn"}
              className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-foreground/85 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              {BLOCKS.find((b) => b.id === s.block)?.label}
              <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-fast)", panel === "turn" && "rotate-180")} />
            </ToolbarButton>
            {s.block !== "code" && (
              <>
                <Sep />
                <Btn icon={Bold} label="Жирный" shortcut="Ctrl B" active={s.bold} onClick={() => c().toggleBold().run()} />
                <Btn icon={Italic} label="Курсив" shortcut="Ctrl I" active={s.italic} onClick={() => c().toggleItalic().run()} />
                <Btn
                  icon={Underline}
                  label="Подчёркнутый"
                  shortcut="Ctrl U"
                  active={s.underline}
                  onClick={() => c().toggleUnderline().run()}
                />
                <Btn
                  icon={Strikethrough}
                  label="Зачёркнутый"
                  shortcut="Ctrl Shift S"
                  active={s.strike}
                  onClick={() => c().toggleStrike().run()}
                />
                <Btn icon={Code} label="Код" shortcut="Ctrl E" active={s.code} onClick={() => c().toggleCode().run()} />
                <Sep />
                <Btn
                  icon={Link2}
                  label="Ссылка"
                  shortcut="Ctrl K"
                  active={s.link || panel === "link"}
                  onClick={() => {
                    setUrl(s.href)
                    toggle("link")
                  }}
                />
                <Btn icon={Radical} label="В формулу" shortcut="Ctrl Shift E" onClick={onFormula} />
                <ToolbarButton
                  type="button"
                  title="Цвет текста и фона"
                  aria-label="Цвет текста и фона"
                  aria-expanded={panel === "color"}
                  onMouseDown={keep}
                  onClick={() => toggle("color")}
                  className="flex h-8 items-center gap-0.5 rounded-lg px-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className="flex size-5 items-center justify-center rounded-md"
                    style={{ background: s.bgColor && s.bgColor !== "default" ? `var(--hl-${s.bgColor})` : undefined }}
                  >
                    <Baseline className="size-4" style={{ color: s.textColor ? `var(--tc-${s.textColor})` : undefined }} />
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </ToolbarButton>
                <Sep />
                <Btn
                  icon={Pin}
                  label="В закреп"
                  onClick={() => {
                    const text = selectionText()
                    if (text) onPin(text)
                  }}
                />
              </>
            )}
          </ToolbarMouse.Provider>
        </div>

        <AnimatePresence>
          {panel && (
            <motion.div
              key={panel}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 520, damping: 34 } }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
              className="glass absolute top-full left-0 mt-1.5 rounded-[0.875rem] p-1.5"
            >
              {panel === "turn" && (
                <ul role="menu" aria-label="Превратить в" className="w-56">
                  <li className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Превратить в</li>
                  {BLOCKS.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={s.block === b.id}
                        onMouseDown={keep}
                        onClick={() => {
                          turnInto(editor, b.id)
                          setPanel(null)
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
                      >
                        <span className="flex-1">{b.label}</span>
                        {s.block === b.id && <Check className="size-3.5 text-highlight" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {panel === "color" && (
                <div className="w-60 space-y-2 p-1">
                  <ColorRow
                    title="Цвет текста"
                    kind="text"
                    current={s.textColor}
                    onDefault={() => c().unsetTextColor().run()}
                    onPick={(color) => {
                      remember("text", color)
                      c().setTextColor(color).run()
                    }}
                  />
                  <ColorRow
                    title="Фон"
                    kind="bg"
                    current={s.bgColor === "default" ? null : s.bgColor}
                    onDefault={() => c().unsetHighlight().run()}
                    onPick={(color) => {
                      remember("bg", color)
                      c().setHighlight({ color }).run()
                    }}
                  />
                  <button
                    type="button"
                    onMouseDown={keep}
                    onClick={() => c().toggleHighlight().run()}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <mark className="rounded px-1" style={{ background: "var(--hl-default)", color: "inherit" }}>
                      Маркер
                    </mark>{" "}
                  </button>
                </div>
              )}

              {panel === "link" && (
                <form
                  className="flex w-72 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    applyLink()
                  }}
                >
                  <input
                    ref={linkInput}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault()
                        setPanel(null)
                        editor.commands.focus()
                      }
                    }}
                    placeholder="Вставь ссылку…"
                    aria-label="Адрес ссылки"
                    className="h-8 min-w-0 flex-1 rounded-lg border bg-background/70 px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Btn icon={Check} label="Применить" onClick={applyLink} />
                  {s.link && (
                    <Btn
                      icon={Link2Off}
                      label="Убрать ссылку"
                      onClick={() => {
                        c().extendMarkRange("link").unsetLink().run()
                        setPanel(null)
                      }}
                    />
                  )}
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </BubbleMenu>
  )
}

function ColorRow({
  title,
  kind,
  current,
  onPick,
  onDefault,
}: {
  title: string
  kind: "text" | "bg"
  current: NoteColor | null
  onPick: (c: NoteColor) => void
  onDefault: () => void
}) {
  return (
    <div>
      <div className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</div>
      <div className="grid grid-cols-5 gap-1">
        <Swatch label="Обычный" active={!current} kind={kind} onClick={onDefault} />
        {NOTE_COLORS.map((c) => (
          <Swatch key={c} color={c} label={COLOR_LABELS[c]} active={current === c} kind={kind} onClick={() => onPick(c)} />
        ))}
      </div>
    </div>
  )
}

function Swatch({
  color,
  label,
  active,
  kind,
  onClick,
}: {
  color?: NoteColor
  label: string
  active: boolean
  kind: "text" | "bg"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={`${kind === "text" ? "Текст" : "Фон"}: ${label}`}
      aria-pressed={active}
      onMouseDown={keep}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-center rounded-lg border text-[13px] font-semibold outline-none transition-transform duration-(--dur-fast) hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
        active ? "border-highlight ring-1 ring-highlight" : "border-border",
      )}
      style={
        kind === "text"
          ? { color: color ? `var(--tc-${color})` : undefined }
          : { background: color ? `var(--hl-${color})` : "var(--background)" }
      }
    >
      A
    </button>
  )
}
