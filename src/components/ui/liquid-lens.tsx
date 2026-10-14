import { animate, motion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

/*
 * Liquid Glass по описанию Apple (WWDC25 «Meet Liquid Glass»): не размытие, а линза.
 *   • преломление — фон изгибается у краёв, в центре почти не тронут; карта смещения
 *     рассчитывается под форму элемента (скруглённый прямоугольник), а не берётся из шума;
 *   • дисперсия — каналы R, G, B смещаются с чуть разной силой, у кромки появляется радужная кайма;
 *   • материализация — появляется/исчезает нарастанием преломления, а не только прозрачностью;
 *   • блик по кромке следует за курсором, при нажатии стекло «наполняется светом» от точки касания.
 * backdrop-filter: url() умеют только Chromium-браузеры (Edge, Chrome) — в остальных остаётся
 * обычное стекло колонки (класс fallback).
 */

/** Edge/Chrome — да; Firefox и Safari парсят url() в backdrop-filter, но ничего не рисуют. */
export const lensSupported =
  typeof navigator !== 'undefined' &&
  /Chrome\/\d/.test(navigator.userAgent) &&
  !/Firefox|FxiOS|CriOS/.test(navigator.userAgent) &&
  !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-transparency: reduce)').matches)

/**
 * Карта смещения: R — сдвиг по x, G — по y, 128 = на месте.
 * У кромки (в полосе bezel) пиксель берётся глубже внутри — так выглядит выпуклый край линзы.
 */
function lensMap(w: number, h: number, radius: number, bezel: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
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
      // расстояние до края внутрь (signed distance скруглённого прямоугольника)
      const inside = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r)
      // нормаль к ближайшему краю
      let nx = 0
      let ny = 0
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1
        nx = (qx / l) * Math.sign(px)
        ny = (qy / l) * Math.sign(py)
      } else if (qx > qy) nx = Math.sign(px)
      else ny = Math.sign(py)
      const t = Math.min(Math.max(1 - inside / bezel, 0), 1)
      const m = t * t * (3 - 2 * t) // плавно растёт к кромке
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

/**
 * Маска «близость к углам»: непрозрачно у середины каждой дуги скругления, к сторонам гаснет.
 * Считается в пикселях, а не по углу от центра — иначе у высокой панели свет тянулся бы вдоль сторон.
 */
function cornerMask(w: number, h: number, r: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return 'none'
  const k = r * (1 - Math.SQRT1_2) // от угла рамки до середины дуги
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

/** Матрица, оставляющая один канал (0 — R, 1 — G, 2 — B) и альфу. */
const channel = (c: 0 | 1 | 2) =>
  [0, 1, 2].map((k) => [0, 1, 2, 3, 4].map((j) => (k === c && j === k ? 1 : 0)).join(' ')).join('  ') + '  0 0 0 1 0'

interface Options {
  /** ширина «скоса» у кромки, где фон преломляется */
  bezel?: number
  /** наибольший сдвиг фона у самой кромки, px */
  refraction?: number
  /** разница сдвига между каналами — сила радужной каймы (0.08 = ±8 %) */
  dispersion?: number
  /** лёгкая матовость, px */
  frost?: number
  /** скрыто — преломление гаснет */
  hidden?: boolean
  /** menu — над текстом: сильнее рассеивает и притемняет; card — крупное «толстое» стекло под текстом карточек */
  variant?: 'bar' | 'menu' | 'card'
  /** классы стекла, если линза не поддерживается (Firefox, Safari, «уменьшить прозрачность») */
  fallback?: string
}

/**
 * Подключает линзу к элементу. Использование:
 *   const lens = useLiquidLens({ fallback: 'liquid liquid-lava' })
 *   <div ref={lens.attach} style={lens.style} className={cn(lens.className, …)}>{lens.extras}…</div>
 * Радиус скругления берётся из стилей самого элемента.
 */
export function useLiquidLens({ bezel = 14, refraction = 16, dispersion = 0.08, frost = 1, hidden, variant = 'bar', fallback = '' }: Options = {}) {
  const id = `lens-${useId().replace(/:/g, '')}`
  // callback-ref: элемент может появиться позже первого рендера
  const [el, attach] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number; r: number } | null>(null)
  const maps = useRef<(SVGFEDisplacementMapElement | null)[]>([])

  useLayoutEffect(() => {
    if (!el || !lensSupported) return
    // размер без transform (у панели есть сдвиги и пружины) — offsetWidth/offsetHeight
    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2)
      if (w && h) setSize((s) => (s && s.w === w && s.h === h && s.r === r ? s : { w, h, r }))
    }
    // всплывающие меню монтируются скрытыми (0×0) — замер повторяется, пока не появятся
    let raf = 0
    let tries = 0
    const retry = () => {
      measure()
      if (!el.offsetWidth && tries++ < 600) raf = requestAnimationFrame(retry)
    }
    retry()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // меню выделения показывают, меняя стиль самого элемента, — тоже повод замерить
    const mo = new MutationObserver(measure)
    // сам элемент и пара обёрток над ним (BubbleMenu оборачивает содержимое своим блоком)
    for (let n: HTMLElement | null = el, d = 0; n && d < 3; n = n.parentElement, d++) {
      mo.observe(n, { attributes: true, attributeFilter: ['style', 'class', 'data-state'] })
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
    }
  }, [el])

  const href = useMemo(() => (size ? lensMap(size.w, size.h, size.r, Math.min(bezel, size.w / 2, size.h / 2)) : ''), [size, bezel])
  const corners = useMemo(() => (size ? cornerMask(size.w, size.h, size.r) : 'none'), [size])

  // материализация: сила преломления плавно нарастает/гаснет
  const scale = useRef(hidden ? 0 : refraction * 2)
  useEffect(() => {
    const target = hidden ? 0 : refraction * 2
    const ctrl = animate(scale.current, target, {
      type: 'spring',
      stiffness: 220,
      damping: 26,
      onUpdate: (v) => {
        scale.current = v
        maps.current.forEach((m, k) => m?.setAttribute('scale', String(v * (1 + (k - 1) * dispersion))))
      },
    })
    return () => ctrl.stop()
  }, [hidden, refraction, dispersion])

  const active = lensSupported && !!href && !!size
  // пятно призмы — доля большей стороны (не больше 130px): иначе маленькая капсула целиком
  // попадает в яркую зону и светится сильнее высокой панели
  const style = active
    ? ({
        backdropFilter: `url(#${id})`,
        WebkitBackdropFilter: `url(#${id})`,
        '--prism-r': `${Math.round(Math.min(130, Math.max(size.w, size.h) * 0.3))}px`,
        '--prism-corners': corners,
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
        {/* живость цвета под стеклом, как у Apple */}
        <feColorMatrix in="rgb" type="saturate" values="1.35" />
      </filter>
    </svg>
  ) : null

  const className = active ? (variant === 'bar' ? 'liquid-lens' : `liquid-lens liquid-lens-${variant}`) : fallback
  const extras = (
    <>
      {filter}
      {active && <LensLight host={el} />}
    </>
  )
  return { attach, el, style, className, extras, active }
}

/** Блик по кромке за курсором + свечение от точки нажатия. Кладётся первым ребёнком линзы. */
export function LensLight({ host: el }: { host: HTMLElement | null }) {
  const [press, setPress] = useState<{ x: number; y: number; n: number } | null>(null)
  useEffect(() => {
    if (!el) return
    const move = (e: PointerEvent) => {
      el.dataset.lit = ''
      const r = el.getBoundingClientRect()
      el.style.setProperty('--lx', `${e.clientX - r.left}px`)
      el.style.setProperty('--ly', `${e.clientY - r.top}px`)
    }
    // блик гаснет там, где был курсор, а не прыгает в угол
    const leave = () => {
      delete el.dataset.lit
    }
    const down = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      setPress((p) => ({ x: e.clientX - r.left, y: e.clientY - r.top, n: (p?.n ?? 0) + 1 }))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerdown', down)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerdown', down)
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

/** Блок с линзой — для мест, где хук неудобно подключать к готовому элементу. */
export function LensBox({ lens: opts, className, style, children }: { lens?: Options; className?: string; style?: CSSProperties; children?: React.ReactNode }) {
  const lens = useLiquidLens(opts)
  return (
    <div ref={lens.attach} style={{ ...style, ...lens.style }} className={[lens.className, className].filter(Boolean).join(' ')}>
      {lens.extras}
      {children}
    </div>
  )
}
