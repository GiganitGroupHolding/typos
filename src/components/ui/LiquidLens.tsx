import type { CSSProperties, ReactNode } from "react"

interface Options {
  fallback?: string
}

/** Использует общий CSS-материал без SVG-фильтров, измерений и обработчиков указателя. */
export function useLiquidLens({ fallback = "" }: Options = {}) {
  return {
    className: fallback,
  }
}

export function LensBox({
  lens: opts,
  className,
  style,
  children,
}: {
  lens?: Options
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  const lens = useLiquidLens(opts)
  return (
    <div style={style} className={[lens.className, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  )
}
