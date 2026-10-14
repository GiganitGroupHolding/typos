import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useRef } from 'react'
import { Link } from 'react-router'
import { useLiquidLens } from '@/components/ui/liquid-lens'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toolIcons } from '@/features/subjects/visuals'
import { cn } from '@/lib/utils'
import type { Tool } from '@/types'

/*
 * Dock тулз предмета. Идея — 21st.dev «macOS Dock» (ssicevs) / «Dock Nav» (soralabs):
 * размер иконки зависит от расстояния до курсора. Заменить на оригинал после ключа 21st.
 * Анимируется только transform (scale), раскладка не дёргается.
 */

const BASE = 48

function DockIcon({ tool, mouseX }: { tool: Tool; mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const Icon = toolIcons[tool.icon]

  const distance = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || !Number.isFinite(x)) return Infinity
    return x - (r.left + r.width / 2)
  })
  const scaleRaw = useTransform(distance, [-110, 0, 110], [1, 1.35, 1], { clamp: true })
  const scale = useSpring(scaleRaw, { stiffness: 400, damping: 28, mass: 0.5 })
  const y = useTransform(scale, (s) => -(s - 1) * BASE * 0.5)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          ref={ref}
          to={`/s/${tool.subjectId}/t/${tool.id}`}
          aria-label={tool.name}
          className="relative block rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ width: BASE, height: BASE }}
        >
          <motion.span
            style={{ scale, y }}
            whileTap={{ scale: 0.92 }}
            className="flex size-full origin-bottom items-center justify-center rounded-[14px] border bg-card text-highlight shadow-card"
          >
            <Icon className="size-[22px]" strokeWidth={1.75} />
          </motion.span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={14}>
        {tool.name}
      </TooltipContent>
    </Tooltip>
  )
}

export function ToolDock({ tools }: { tools: Tool[] }) {
  const mouseX = useMotionValue(Infinity)
  const lens = useLiquidLens({ bezel: 16, refraction: 16, dispersion: 0.09, frost: 1, fallback: 'liquid' })
  return (
    <div
      ref={lens.attach}
      style={lens.style}
      onPointerMove={(e) => e.pointerType === 'mouse' && mouseX.set(e.clientX)}
      onPointerLeave={() => mouseX.set(Infinity)}
      className={cn(lens.className, 'inline-flex items-end gap-3 rounded-[1.4rem] px-3 pt-3 pb-3')}
    >
      {lens.extras}
      {tools.map((t) => (
        <DockIcon key={t.id} tool={t} mouseX={mouseX} />
      ))}
    </div>
  )
}
