import type { BoardFrameShape, Bounds } from "./model"

const SQRT3 = Math.sqrt(3)
const hexRadius = (w: number, h: number) => Math.min(w / 2, h / SQRT3)

export function frameRadius(shape: BoardFrameShape | undefined, w: number, h: number, x: number, y: number) {
  const a = w / 2
  const b = h / 2
  if (shape === "circle") return Math.min(a, b)
  x = Math.abs(x)
  y = Math.abs(y)
  if (shape === "hexagon") {
    const r = hexRadius(w, h)
    return Math.min((r * SQRT3) / (2 * y), r / (x + y / SQRT3))
  }
  const distance = Math.min(a / x, b / y)
  const corner = Math.min(18, a, b)
  const cx = a - corner
  const cy = b - corner
  if (distance * x <= cx || distance * y <= cy) return distance
  const projection = cx * x + cy * y
  return projection + Math.sqrt(Math.max(0, corner ** 2 - (cx * y - cy * x) ** 2))
}

export function fitFrame(frame: Bounds, shape: BoardFrameShape, content: Bounds | null): Bounds {
  if (!content) return frame
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  const x = Math.max(cx - content.x, content.x + content.width - cx)
  const y = Math.max(cy - content.y, content.y + content.height - cy)
  const distance = Math.hypot(x, y)
  if (!distance || distance <= frameRadius(shape, frame.width, frame.height, x / distance, y / distance)) return frame

  const padding = 18
  const radius =
    shape === "circle" ? Math.hypot(x + padding, y + padding) : Math.max((2 * (y + padding)) / SQRT3, x + padding + (y + padding) / SQRT3)
  const width = Math.max(frame.width, Math.ceil(shape === "rectangle" ? 2 * (x + padding) : 2 * radius))
  const height = Math.max(
    frame.height,
    Math.ceil(shape === "rectangle" ? 2 * (y + padding) : shape === "circle" ? 2 * radius : SQRT3 * radius),
  )
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

export function frameContainsPoint(frame: Bounds, shape: BoardFrameShape | undefined, px: number, py: number): boolean {
  const x = px - frame.x - frame.width / 2
  const y = py - frame.y - frame.height / 2
  const distance = Math.hypot(x, y)
  return distance === 0 || distance <= frameRadius(shape, frame.width, frame.height, x / distance, y / distance)
}

export function framePath(shape: BoardFrameShape | undefined, w: number, h: number) {
  const a = w / 2
  const b = h / 2
  const point = (x: number, y: number) => `${(a + x).toFixed(3)},${(b + y).toFixed(3)}`
  let path = ""
  const start = (x: number, y: number) => {
    path = `M${point(x, y)}`
  }
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    path += ` C${point(x1, y1)} ${point(x2, y2)} ${point(x, y)}`
  }
  const line = (x: number, y: number) => cubic(x, y, x, y, x, y)

  // По 12 сегментов у каждой фигуры, чтобы при смене формы интерполировать один контур.
  if (shape === "circle") {
    const r = Math.min(a, b)
    const step = Math.PI / 6
    const k = (4 / 3) * Math.tan(step / 4)
    start(r, 0)
    for (let i = 0; i < 12; i++) {
      const t = i * step
      const u = t + step
      const x0 = r * Math.cos(t),
        y0 = r * Math.sin(t)
      const x = r * Math.cos(u),
        y = r * Math.sin(u)
      cubic(x0 - k * y0, y0 + k * x0, x + k * y, y - k * x, x, y)
    }
  } else if (shape === "hexagon") {
    const r = hexRadius(w, h)
    const y = (r * SQRT3) / 2
    const vertices = [
      [r, 0],
      [r / 2, y],
      [-r / 2, y],
      [-r, 0],
      [-r / 2, -y],
      [r / 2, -y],
    ]
    start(r, 0)
    for (const [i, [x0, y0]] of vertices.entries()) {
      const [x, y] = vertices[(i + 1) % 6]
      line((x0 + x) / 2, (y0 + y) / 2)
      line(x, y)
    }
  } else {
    const r = Math.min(18, a, b)
    const k = r * ((4 / 3) * (Math.SQRT2 - 1))
    start(a, 0)
    line(a, b - r)
    cubic(a, b - r + k, a - r + k, b, a - r, b)
    line(0, b)
    line(-a + r, b)
    cubic(-a + r - k, b, -a, b - r + k, -a, b - r)
    line(-a, 0)
    line(-a, -b + r)
    cubic(-a, -b + r - k, -a + r - k, -b, -a + r, -b)
    line(0, -b)
    line(a - r, -b)
    cubic(a - r + k, -b, a, -b + r - k, a, -b + r)
    line(a, 0)
  }
  return path + " Z"
}
