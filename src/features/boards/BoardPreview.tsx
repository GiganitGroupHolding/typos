import { memo } from 'react'
import { cn } from '@/lib/utils'
import { boardBounds, type BoardData } from './model'

const fill = (c?: string) => (c && /^[1-6]$/.test(c) ? `var(--board-${c})` : c || 'var(--card)')

export const BoardPreview = memo(function BoardPreview({ data, className }: { data: BoardData; className?: string }) {
  const b = boardBounds(data.nodes)
  const pad = b ? Math.max(b.width, b.height) * 0.06 : 0
  return (
    <svg
      aria-hidden
      viewBox={b ? `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}` : '0 0 160 100'}
      preserveAspectRatio="xMidYMid meet"
      className={cn('block', className)}
    >
      {data.nodes.map((n) => (
        <rect
          key={n.id}
          x={n.x}
          y={n.y}
          width={n.width}
          height={n.height}
          rx={Math.min(n.width, n.height) * 0.08}
          fill={n.type === 'group' ? 'none' : fill(n.color)}
          stroke="var(--border)"
          strokeWidth={b ? Math.max(b.width, b.height) / 160 : 1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
})
