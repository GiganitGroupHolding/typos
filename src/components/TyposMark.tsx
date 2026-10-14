/**
 * Знак TYPOS: шестиугольник в шестиугольнике — стеклянная призма сверху (как в референсе).
 * Контур — currentColor, грани — полупрозрачное «стекло», центр — цвет акцента (в предмете — его цвет).
 * Та же геометрия в scripts/gen-icons.mjs (иконки, favicon).
 */

const hex = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return [32 + r * Math.cos(a), 32 + r * Math.sin(a)] as const
  })
const OUTER = hex(26)
const INNER = hex(11)
const pts = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
/** Грани по часовой от верхней правой; свет сверху слева. */
const FACE_ALPHA = [0.16, 0.08, 0.05, 0.07, 0.12, 0.22]

export function TyposMark({ className }: { className?: string }) {
  return (
    <svg viewBox="7.5 4.5 49 55" aria-hidden="true" className={className} strokeLinejoin="round">
      {OUTER.map((p, i) => {
        const j = (i + 1) % 6
        return <polygon key={i} points={pts([p, OUTER[j], INNER[j], INNER[i]])} fill="currentColor" fillOpacity={FACE_ALPHA[i]} />
      })}
      <polygon points={pts(INNER)} fill="var(--primary)" />
      <g fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke">
        <polygon points={pts(OUTER)} vectorEffect="non-scaling-stroke" />
        <polygon points={pts(INNER)} vectorEffect="non-scaling-stroke" />
        {OUTER.map(([x, y], i) => (
          <line key={i} x1={x} y1={y} x2={INNER[i][0]} y2={INNER[i][1]} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  )
}
