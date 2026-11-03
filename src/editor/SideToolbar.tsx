import { useEditorState, type Editor } from "@tiptap/react"
import {
  Bold,
  Heading2,
  ImagePlus,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Radical,
  SquareFunction,
  Table,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react"
import { useRef } from "react"
import { useUi } from "@/app/store"
import { Kbd } from "@/components/ui/Kbd"
import { useLiquidLens } from "@/components/ui/LiquidLens"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip"
import { cn } from "@/lib/utils"

interface Item {
  icon: LucideIcon
  label: string
  key?: string
  active?: boolean
  run: () => void
}

const SIZE = 36

function DockButton({ item, mouseY }: { item: Item; mouseY: MotionValue<number> }) {
  const ref = useRef<HTMLButtonElement>(null)
  const distance = useTransform(mouseY, (y) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || !Number.isFinite(y)) return Infinity
    return y - (r.top + r.height / 2)
  })
  const scale = useSpring(useTransform(distance, [-90, 0, 90], [1, 1.22, 1], { clamp: true }), { stiffness: 420, damping: 30, mass: 0.5 })
  const x = useTransform(scale, (s) => -(s - 1) * SIZE * 0.5)
  const Icon = item.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          ref={ref}
          type="button"
          aria-label={item.label}
          aria-pressed={item.active}
          onMouseDown={(e) => e.preventDefault()}
          onClick={item.run}
          style={{ scale, x, width: SIZE, height: SIZE }}
          whileTap={{ scale: 0.9 }}
          className={cn(
            "flex origin-right items-center justify-center rounded-xl outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring",
            item.active ? "liquid-active" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
        >
          <Icon className="size-[18px]" strokeWidth={1.9} />
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={12} className="flex items-center gap-2">
        {item.label}
        {item.key && <Kbd>{item.key}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export function SideToolbar({
  editor,
  hidden,
  onFormula,
  onBlockFormula,
  onImage,
}: {
  editor: Editor | null
  hidden?: boolean
  onFormula: () => void
  onBlockFormula: () => void
  onImage: () => void
}) {
  const pinsOpen = useUi((s) => s.pinsOpen)
  const mapMode = useUi((s) => s.mapMode)
  const setMapMode = useUi((s) => s.setMapMode)
  const mouseY = useMotionValue(Infinity)
  const lens = useLiquidLens({ bezel: 14, refraction: 16, dispersion: 0.09, frost: 1, hidden, fallback: "liquid liquid-lava" })
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            h2: e.isActive("heading", { level: 2 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            task: e.isActive("taskList"),
            quote: e.isActive("blockquote"),
            table: e.isActive("table"),
          }
        : null,
  })
  if (!editor || !s) return null
  const c = () => editor.chain().focus()

  const groups: Item[][] = [
    [
      { icon: Bold, label: "Жирный", key: "Ctrl B", active: s.bold, run: () => c().toggleBold().run() },
      { icon: Italic, label: "Курсив", key: "Ctrl I", active: s.italic, run: () => c().toggleItalic().run() },
      { icon: Heading2, label: "Подзаголовок", key: "## ", active: s.h2, run: () => c().toggleHeading({ level: 2 }).run() },
    ],
    [
      { icon: List, label: "Список", key: "- ", active: s.bullet, run: () => c().toggleBulletList().run() },
      { icon: ListOrdered, label: "Нумерованный список", key: "1. ", active: s.ordered, run: () => c().toggleOrderedList().run() },
      { icon: ListChecks, label: "Чек-лист", key: "[ ] ", active: s.task, run: () => c().toggleTaskList().run() },
      { icon: Quote, label: "Цитата", key: "> ", active: s.quote, run: () => c().toggleBlockquote().run() },
      {
        icon: Table,
        label: "Таблица",
        active: s.table,
        run: () => !s.table && c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
    ],
    [
      { icon: Radical, label: "Формула в строке", key: "$x$", run: onFormula },
      { icon: SquareFunction, label: "Блочная формула", key: "$$ ", run: onBlockFormula },
      { icon: ImagePlus, label: "Картинка", key: "Ctrl V", run: onImage },
    ],
    [
      {
        icon: Workflow,
        label: mapMode ? "Выйти из карты" : "Карта",
        key: mapMode ? "Esc" : undefined,
        active: mapMode,
        run: () => {
          if (!mapMode) editor.commands.blur()
          setMapMode(!mapMode)
        },
      },
    ],
  ]

  return (
    <motion.div
      ref={lens.attach}
      role="toolbar"
      aria-label="Форматирование"
      aria-orientation="vertical"
      aria-hidden={hidden}
      initial={false}
      animate={{
        x: hidden ? 24 : pinsOpen ? -356 : 0,
        opacity: hidden ? 0 : 1,
        transition: { type: "spring", stiffness: 320, damping: 32 },
      }}
      onPointerMove={(e) => e.pointerType === "mouse" && mouseY.set(e.clientY)}
      onPointerLeave={() => mouseY.set(Infinity)}
      style={lens.style}
      className={cn(
        "fixed top-1/2 right-4 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-[1.4rem] p-1.5",
        lens.className,
        hidden && "pointer-events-none",
      )}
    >
      {lens.extras}
      {groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {i > 0 && <div aria-hidden className="mx-auto my-1 h-px w-5 bg-border" />}
          {g.map((item) => (
            <DockButton key={item.label} item={item} mouseY={mouseY} />
          ))}
        </div>
      ))}
    </motion.div>
  )
}
