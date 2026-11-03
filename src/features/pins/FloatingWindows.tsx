import { GripHorizontal, X } from "lucide-react"
import { AnimatePresence, motion, useDragControls } from "motion/react"
import { useRef, type RefObject } from "react"
import { useUi, type FloatingWindow } from "@/app/store"
import { Button } from "@/components/ui/Button"
import { ProjectViewer } from "@/features/tools/ProjectViewer"
import { dur, easeIn, springSoft } from "@/lib/motion"
import { usePin, useTool } from "@/vault/hooks"
import { PinBody } from "./PinCard"

function Window({ win, bounds }: { win: FloatingWindow; bounds: RefObject<HTMLDivElement | null> }) {
  const controls = useDragControls()
  const close = useUi((s) => s.closeWindow)
  const focus = useUi((s) => s.focusWindow)
  const pin = usePin(win.kind === "pin" ? win.refId : undefined)
  const tool = useTool(win.kind === "tool" ? win.refId : undefined)
  const title = pin?.title ?? tool?.name ?? "Окно"
  const isTool = win.kind === "tool"

  return (
    <motion.section
      role="dialog"
      aria-label={title}
      layoutId={pin ? `pin-${pin.id}` : undefined}
      drag
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      dragConstraints={bounds}
      dragElastic={0.04}
      onPointerDown={() => focus(win.id)}
      initial={pin ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: springSoft }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: dur.base * 0.65, ease: easeIn } }}
      style={{
        top: 72 + win.slot * 28,

        right: `clamp(8px, ${380 + win.slot * 28}px, calc(100vw - ${(isTool ? 440 : 320) + 8}px))`,
        zIndex: win.z,
      }}
      className="glass pointer-events-auto absolute flex flex-col overflow-hidden rounded-[var(--radius-surface)]"
    >
      <header
        onPointerDown={(e) => controls.start(e)}
        className="flex cursor-grab touch-none items-center gap-2 border-b bg-muted/50 px-3 py-2 select-none active:cursor-grabbing"
      >
        <GripHorizontal aria-hidden className="size-4 text-muted-foreground" />
        <span className="flex-1 truncate text-[13px] font-semibold">{title}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Закрыть «${title}»`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => close(win.id)}
        >
          <X />
        </Button>
      </header>
      <div className={isTool ? "h-[380px] w-[min(440px,calc(100vw-16px))]" : "w-[min(320px,calc(100vw-16px))] px-4 py-3"}>
        {pin && <PinBody pin={pin} hideTitle />}
        {tool && <ProjectViewer tool={tool} />}
      </div>
    </motion.section>
  )
}

export function FloatingWindows() {
  const windows = useUi((s) => s.windows)
  const bounds = useRef<HTMLDivElement>(null)
  return (
    <div ref={bounds} className="pointer-events-none fixed inset-0 z-40">
      <AnimatePresence>
        {windows.map((w) => (
          <Window key={w.id} win={w} bounds={bounds} />
        ))}
      </AnimatePresence>
    </div>
  )
}
