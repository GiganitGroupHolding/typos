export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

export function sidePoint(r: Rect, side: Side) {
  const c = center(r)
  if (side === 'top') return { x: c.x, y: r.y }
  if (side === 'bottom') return { x: c.x, y: r.y + r.h }
  if (side === 'left') return { x: r.x, y: c.y }
  return { x: r.x + r.w, y: c.y }
}

const NORMAL: Record<Side, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }

export function facingSides(a: Rect, b: Rect): [Side, Side] {
  const ac = center(a)
  const bc = center(b)
  const dx = bc.x - ac.x
  const dy = bc.y - ac.y
  if (Math.abs(dx) / (a.w + b.w) > Math.abs(dy) / (a.h + b.h)) return dx > 0 ? ['right', 'left'] : ['left', 'right']
  return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

export function curve(s: { x: number; y: number }, sSide: Side, t: { x: number; y: number }, tSide: Side | null) {
  const len = Math.hypot(t.x - s.x, t.y - s.y)
  const k = Math.max(18, Math.min(120, len * 0.42))
  const [sx, sy] = NORMAL[sSide]
  const c1 = { x: s.x + sx * k, y: s.y + sy * k }
  const [tx, ty] = tSide ? NORMAL[tSide] : [0, 0]
  const c2 = { x: t.x + tx * k, y: t.y + ty * k }

  const mid = { x: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8, y: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8 }
  const f = (n: number) => Math.round(n * 10) / 10
  return { d: `M${f(s.x)} ${f(s.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(t.x)} ${f(t.y)}`, mid }
}

export function edgePath(a: Rect, b: Rect) {
  const [sa, sb] = facingSides(a, b)
  return curve(sidePoint(a, sa), sa, sidePoint(b, sb), sb)
}

export const contains = (r: Rect, p: { x: number; y: number }, pad = 0) =>
  p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad

export const rectOf = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  x: Math.min(x0, x1),
  y: Math.min(y0, y1),
  w: Math.abs(x1 - x0),
  h: Math.abs(y1 - y0),
})

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max))
