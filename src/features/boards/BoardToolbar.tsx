import {
  ArrowLeftRight,
  ArrowRight,
  BringToFront,
  Circle,
  Copy,
  Frame,
  Hand,
  Hexagon,
  ImagePlus,
  Link2,
  Minus,
  MousePointer2,
  Redo2,
  Scan,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip"
import { cn } from "@/lib/utils"
import { BOARD_COLOR_LABELS, BOARD_COLORS, type BoardEdge, type BoardFrameShape } from "./model"

export type BoardTool = "select" | "hand" | "sticky" | "text" | "frame"

const TOOLS: { id: BoardTool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "select", label: "Выбор", key: "V", icon: MousePointer2 },
  { id: "hand", label: "Рука — двигать доску", key: "H или пробел", icon: Hand },
  { id: "sticky", label: "Стикер", key: "S", icon: StickyNote },
  { id: "text", label: "Карточка с текстом", key: "T", icon: Type },
  { id: "frame", label: "Рамка", key: "F", icon: Frame },
]

function Glass({ children }: { children: ReactNode }) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="liquid liquid-lava pointer-events-auto flex items-center gap-0.5 rounded-full p-1 shadow-float"
    >
      {children}
    </div>
  )
}

function IconButton({
  label,
  hint,
  active,
  onClick,
  children,
}: {
  label: string
  hint?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "flex size-8 items-center justify-center rounded-full outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
            active && "liquid-active hover:bg-transparent",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{hint ? `${label} · ${hint}` : label}</TooltipContent>
    </Tooltip>
  )
}

const Divider = () => <span aria-hidden className="mx-1 h-5 w-px bg-border" />

const FRAME_SHAPES = [
  { id: "rectangle", label: "Прямоугольник", icon: Square },
  { id: "circle", label: "Круг", icon: Circle },
  { id: "hexagon", label: "Шестиугольник", icon: Hexagon },
] as const

export function BoardToolbar({
  tool,
  onTool,
  onImage,
  onLink,
  zoom,
  onZoom,
  onFit,
  onUndo,
  onRedo,
}: {
  tool: BoardTool
  onTool: (t: BoardTool) => void
  onImage: () => void
  onLink: () => void
  zoom: number
  onZoom: (factor: number | "reset") => void
  onFit: () => void
  onUndo: () => void
  onRedo: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
      <Glass>
        {TOOLS.map((t) => (
          <IconButton key={t.id} label={t.label} hint={t.key} active={tool === t.id} onClick={() => onTool(t.id)}>
            <t.icon />
          </IconButton>
        ))}
        <IconButton label="Картинка" onClick={onImage}>
          <ImagePlus />
        </IconButton>
        <IconButton label="Добавить ссылку" onClick={onLink}>
          <Link2 />
        </IconButton>
        <Divider />
        <IconButton label="Отменить" hint="Ctrl Z" onClick={onUndo}>
          <Undo2 />
        </IconButton>
        <IconButton label="Вернуть" hint="Ctrl Shift Z" onClick={onRedo}>
          <Redo2 />
        </IconButton>
        <Divider />
        <IconButton label="Мельче" hint="Ctrl и колесо" onClick={() => onZoom(1 / 1.25)}>
          <ZoomOut />
        </IconButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onZoom("reset")}
              className="h-8 w-12 rounded-full text-[12px] font-medium tabular-nums outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {Math.round(zoom * 100)}%
            </button>
          </TooltipTrigger>
          <TooltipContent>Масштаб 100% · Shift 0</TooltipContent>
        </Tooltip>
        <IconButton label="Крупнее" hint="Ctrl и колесо" onClick={() => onZoom(1.25)}>
          <ZoomIn />
        </IconButton>
        <IconButton label="Показать всё" hint="Shift 1" onClick={onFit}>
          <Scan />
        </IconButton>
      </Glass>
    </div>
  )
}

const swatch = (c: string) => `var(--board-line-${c})`

export function SelectionBar({
  color,
  edge,
  onColor,
  onArrows,
  onFront,
  onDuplicate,
  frameShape,
  onFrameShape,
  onEditLink,
  onDelete,
}: {
  color?: string

  edge?: BoardEdge
  onColor: (c: string | undefined) => void
  onArrows?: () => void
  onFront?: () => void
  onDuplicate?: () => void
  frameShape?: BoardFrameShape
  onFrameShape: (shape: BoardFrameShape) => void
  onEditLink?: () => void
  onDelete: () => void
}) {
  const ends = edge ? `${edge.fromEnd === "arrow" ? "both" : edge.toEnd === "none" ? "none" : "end"}` : null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
      <Glass>
        <button
          type="button"
          aria-label="Без цвета"
          aria-pressed={!color}
          onClick={() => onColor(undefined)}
          className="flex size-8 items-center justify-center rounded-full outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              "size-4 rounded-full border-2 border-muted-foreground/50 bg-card",
              !color && "ring-2 ring-highlight ring-offset-1",
            )}
          />
        </button>
        {BOARD_COLORS.map((c) => (
          <Tooltip key={c}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={BOARD_COLOR_LABELS[c]}
                aria-pressed={color === c}
                onClick={() => onColor(c)}
                className="flex size-8 items-center justify-center rounded-full outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  style={{ background: swatch(c) }}
                  className={cn("size-4 rounded-full", color === c && "ring-2 ring-highlight ring-offset-1 ring-offset-background")}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{BOARD_COLOR_LABELS[c]}</TooltipContent>
          </Tooltip>
        ))}
        <Divider />
        {frameShape &&
          FRAME_SHAPES.map((s) => (
            <IconButton key={s.id} label={s.label} active={frameShape === s.id} onClick={() => onFrameShape(s.id)}>
              <s.icon />
            </IconButton>
          ))}
        {onEditLink && (
          <IconButton label="Редактировать ссылку" hint="Enter" onClick={onEditLink}>
            <Link2 />
          </IconButton>
        )}
        {onArrows && (
          <IconButton label="Концы стрелки" onClick={onArrows}>
            {ends === "both" ? <ArrowLeftRight /> : ends === "none" ? <Minus /> : <ArrowRight />}
          </IconButton>
        )}
        {onFront && (
          <IconButton label="На передний план" onClick={onFront}>
            <BringToFront />
          </IconButton>
        )}
        {onDuplicate && (
          <IconButton label="Дублировать" hint="Ctrl D" onClick={onDuplicate}>
            <Copy />
          </IconButton>
        )}
        <IconButton label="Удалить" hint="Delete" onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </Glass>
    </div>
  )
}
