import { animate, motion } from "motion/react"
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

export const lensSupported =
  typeof navigator !== "undefined" &&
  /Chrome\/\d/.test(navigator.userAgent) &&
  !/Firefox|FxiOS|CriOS/.test(navigator.userAgent) &&
  !(typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-transparency: reduce)").matches)

if (lensSupported && typeof document !== "undefined") {
  let timer = 0
  document.addEventListener(
    "scroll",
    () => {
      if (!timer) document.documentElement.dataset.scrolling = ""
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        delete document.documentElement.dataset.scrolling
      }, 150)
    },
    { capture: true, passive: true },
  )
}

function lensMap(w: number, h: number, radius: number, bezel: number): string {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  const img = ctx.createImageData(w, h)
  const hx = w / 2
  const hy = h / 2
  const r = Math.min(radius, hx, hy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx
      const py = y + 0.5 - hy
      const qx = Math.abs(px) - (hx - r)
      const qy = Math.abs(py) - (hy - r)

      const inside = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r)

      let nx = 0
      let ny = 0
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1
        nx = (qx / l) * Math.sign(px)
        ny = (qy / l) * Math.sign(py)
      } else if (qx > qy) nx = Math.sign(px)
      else ny = Math.sign(py)
      const t = Math.min(Math.max(1 - inside / bezel, 0), 1)
      const m = t * t * (3 - 2 * t)
      const i = (y * w + x) * 4
      img.data[i] = 128 - nx * m * 127
      img.data[i + 1] = 128 - ny * m * 127
      img.data[i + 2] = 128
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

function cornerMask(w: number, h: number, r: number): string {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return "none"
  const k = r * (1 - Math.SQRT1_2)
  const sigma = Math.max(r * 0.75, 8)
  const corners = [
    [k, k],
    [w - k, k],
    [k, h - k],
    [w - k, h - k],
  ]
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d2 = Infinity
      for (const [cx, cy] of corners) d2 = Math.min(d2, (x - cx) ** 2 + (y - cy) ** 2)
      img.data[(y * w + x) * 4 + 3] = Math.round(255 * Math.exp(-d2 / (2 * sigma * sigma)))
    }
  }
  ctx.putImageData(img, 0, 0)
  return `url(${canvas.toDataURL()})`
}

const channel = (c: 0 | 1 | 2) =>
  [0, 1, 2].map((k) => [0, 1, 2, 3, 4].map((j) => (k === c && j === k ? 1 : 0)).join(" ")).join("  ") + "  0 0 0 1 0"

interface Options {
  bezel?: number

  refraction?: number

  dispersion?: number

  frost?: number

  hidden?: boolean

  variant?: "bar" | "menu" | "card"

  fallback?: string
}

export function useLiquidLens({
  bezel = 14,
  refraction = 16,
  dispersion = 0.08,
  frost = 1,
  hidden,
  variant = "bar",
  fallback = "",
}: Options = {}) {
  const id = `lens-${useId().replace(/:/g, "")}`

  const [el, attach] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number; r: number } | null>(null)
  const maps = useRef<(SVGFEDisplacementMapElement | null)[]>([])

  useLayoutEffect(() => {
    if (!el || !lensSupported) return

    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2)
      if (w && h) setSize((s) => (s && s.w === w && s.h === h && s.r === r ? s : { w, h, r }))
    }

    let raf = 0
    let tries = 0
    const retry = () => {
      measure()
      if (!el.offsetWidth && tries++ < 600) raf = requestAnimationFrame(retry)
    }
    retry()
    const ro = new ResizeObserver(measure)
    ro.observe(el)

    const mo = new MutationObserver(measure)

    for (let n: HTMLElement | null = el, d = 0; n && d < 3; n = n.parentElement, d++) {
      mo.observe(n, { attributes: true, attributeFilter: ["style", "class", "data-state"] })
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
    }
  }, [el])

  const href = useMemo(() => (size ? lensMap(size.w, size.h, size.r, Math.min(bezel, size.w / 2, size.h / 2)) : ""), [size, bezel])
  const corners = useMemo(() => (size ? cornerMask(size.w, size.h, size.r) : "none"), [size])

  const scale = useRef(hidden ? 0 : refraction * 2)
  useEffect(() => {
    const target = hidden ? 0 : refraction * 2
    const ctrl = animate(scale.current, target, {
      type: "spring",
      stiffness: 220,
      damping: 26,
      onUpdate: (v) => {
        scale.current = v
        maps.current.forEach((m, k) => m?.setAttribute("scale", String(v * (1 + (k - 1) * dispersion))))
      },
    })
    return () => ctrl.stop()
  }, [hidden, refraction, dispersion])

  const active = lensSupported && !!href && !!size

  const style = active
    ? ({
        backdropFilter: `url(#${id})`,
        WebkitBackdropFilter: `url(#${id})`,
        "--prism-r": `${Math.round(Math.min(130, Math.max(size.w, size.h) * 0.3))}px`,
        "--prism-corners": corners,
      } as CSSProperties)
    : undefined

  const filter = active ? (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <filter id={id} x="0" y="0" width={size.w} height={size.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage href={href} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
        <feGaussianBlur in="SourceGraphic" stdDeviation={frost} result="src" />
        {([0, 1, 2] as const).map((k) => (
          <feDisplacementMap
            key={k}
            ref={(el) => {
              maps.current[k] = el
            }}
            in="src"
            in2="map"
            scale={(hidden ? 0 : refraction * 2) * (1 + (k - 1) * dispersion)}
            xChannelSelector="R"
            yChannelSelector="G"
            result={`d${k}`}
          />
        ))}
        {([0, 1, 2] as const).map((k) => (
          <feColorMatrix key={k} in={`d${k}`} type="matrix" values={channel(k)} result={`c${k}`} />
        ))}
        <feComposite in="c0" in2="c1" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
        <feComposite in="rg" in2="c2" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rgb" />

        <feColorMatrix in="rgb" type="saturate" values="1.35" />
      </filter>
    </svg>
  ) : null

  const className = active ? (variant === "bar" ? "liquid-lens" : `liquid-lens liquid-lens-${variant}`) : fallback
  const extras = (
    <>
      {filter}
      {active && <LensLight host={el} />}
    </>
  )
  return { attach, el, style, className, extras, active }
}

export function LensLight({ host: el }: { host: HTMLElement | null }) {
  const [press, setPress] = useState<{ x: number; y: number; n: number } | null>(null)
  useEffect(() => {
    if (!el) return
    const move = (e: PointerEvent) => {
      el.dataset.lit = ""
      const r = el.getBoundingClientRect()
      el.style.setProperty("--lx", `${e.clientX - r.left}px`)
      el.style.setProperty("--ly", `${e.clientY - r.top}px`)
    }

    const leave = () => {
      delete el.dataset.lit
    }
    const down = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      setPress((p) => ({ x: e.clientX - r.left, y: e.clientY - r.top, n: (p?.n ?? 0) + 1 }))
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerleave", leave)
    el.addEventListener("pointerdown", down)
    return () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerleave", leave)
      el.removeEventListener("pointerdown", down)
    }
  }, [el])

  return (
    <span aria-hidden className="lens-light">
      {press && (
        <motion.i
          key={press.n}
          initial={{ opacity: 0.9, scale: 0.2 }}
          animate={{ opacity: 0, scale: 2.4 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          style={{ left: press.x, top: press.y }}
        />
      )}
    </span>
  )
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
    <div ref={lens.attach} style={{ ...style, ...lens.style }} className={[lens.className, className].filter(Boolean).join(" ")}>
      {lens.extras}
      {children}
    </div>
  )
}
