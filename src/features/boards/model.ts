export type BoardNodeType = "text" | "file" | "link" | "group"
export type BoardSide = "top" | "right" | "bottom" | "left"
export type BoardEnd = "none" | "arrow"
export type BoardFrameShape = "rectangle" | "circle" | "hexagon"

export interface BoardNode {
  id: string
  type: BoardNodeType
  x: number
  y: number
  width: number
  height: number

  color?: string

  text?: string

  file?: string

  url?: string

  label?: string
  shape?: BoardFrameShape
}

export interface BoardEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: BoardSide
  toSide?: BoardSide

  fromEnd?: BoardEnd
  toEnd?: BoardEnd
  color?: string
  label?: string
}

export interface BoardData {
  nodes: BoardNode[]
  edges: BoardEdge[]
}

export const BOARD_EXT = ".canvas"
export const BOARD_COLORS = ["1", "2", "3", "4", "5", "6"] as const
export const BOARD_COLOR_LABELS: Record<(typeof BOARD_COLORS)[number], string> = {
  "1": "Красный",
  "2": "Оранжевый",
  "3": "Жёлтый",
  "4": "Зелёный",
  "5": "Голубой",
  "6": "Фиолетовый",
}
export const MIN_NODE_W = 40
export const MIN_NODE_H = 30

const TYPES: BoardNodeType[] = ["text", "file", "link", "group"]
const SIDES: BoardSide[] = ["top", "right", "bottom", "left"]

const COLOR = /^([1-6]|#[0-9a-f]{6})$/i

export const isBoardColor = (c: unknown): c is string => typeof c === "string" && COLOR.test(c)
export const emptyBoard = (): BoardData => ({ nodes: [], edges: [] })

type Raw = Record<string, unknown>
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object") : [])
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const str = (v: unknown) => (typeof v === "string" ? v : undefined)
const side = (v: unknown) => (SIDES.includes(v as BoardSide) ? (v as BoardSide) : undefined)
const end = (v: unknown) => (v === "none" || v === "arrow" ? v : undefined)
const shape = (v: unknown) => (v === "rectangle" || v === "circle" || v === "hexagon" ? v : undefined)

export function boardLinkUrl(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value.trim())) return
  const url = URL.parse(value.trim())
  if (url?.protocol === "http:" || url?.protocol === "https:") return url.href
}

export function parseBoard(text: string | null): { id?: string; data: BoardData } {
  let raw: Raw
  try {
    raw = text ? JSON.parse(text) : {}
  } catch {
    return { data: emptyBoard() }
  }
  if (!raw || typeof raw !== "object") return { data: emptyBoard() }
  const data = emptyBoard()
  const ids = new Set<string>()
  for (const n of list(raw.nodes)) {
    const type = n.type as BoardNodeType
    if (typeof n.id !== "string" || !n.id || ids.has(n.id) || !TYPES.includes(type)) continue
    ids.add(n.id)
    data.nodes.push({
      id: n.id,
      type,
      x: num(n.x),
      y: num(n.y),
      width: Math.max(MIN_NODE_W, num(n.width, 250)),
      height: Math.max(MIN_NODE_H, num(n.height, 60)),
      color: isBoardColor(n.color) ? n.color : undefined,
      text: type === "text" ? (str(n.text) ?? "") : undefined,
      file: type === "file" || type === "link" ? str(n.file) : undefined,
      url: type === "link" ? str(n.url) : undefined,
      label: type === "group" || type === "link" ? str(n.label) : undefined,
      shape: type === "group" ? shape(n.shape) : undefined,
    })
  }
  const edgeIds = new Set<string>()
  for (const e of list(raw.edges)) {
    if (typeof e.id !== "string" || !e.id || edgeIds.has(e.id)) continue
    if (typeof e.fromNode !== "string" || typeof e.toNode !== "string" || !ids.has(e.fromNode) || !ids.has(e.toNode)) continue
    edgeIds.add(e.id)
    data.edges.push({
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
      fromSide: side(e.fromSide),
      toSide: side(e.toSide),
      fromEnd: end(e.fromEnd),
      toEnd: end(e.toEnd),
      color: isBoardColor(e.color) ? e.color : undefined,
      label: str(e.label) || undefined,
    })
  }
  return { id: typeof raw.id === "string" && raw.id ? raw.id : undefined, data }
}

const round = (n: number) => Math.round(n)

export function serializeBoard(id: string, data: BoardData): string {
  const nodes = data.nodes.map((n) => ({ ...n, x: round(n.x), y: round(n.y), width: round(n.width), height: round(n.height) }))
  return `${JSON.stringify({ id, nodes, edges: data.edges }, null, "\t")}\n`
}

export const boardText = (data: BoardData) =>
  [...data.nodes.map((n) => n.text || n.label || n.url || ""), ...data.edges.map((e) => e.label ?? "")].filter(Boolean).join("\n")

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export function boardBounds(nodes: Pick<BoardNode, "x" | "y" | "width" | "height">[]): Bounds | null {
  if (!nodes.length) return null
  const x = Math.min(...nodes.map((n) => n.x))
  const y = Math.min(...nodes.map((n) => n.y))
  return {
    x,
    y,
    width: Math.max(...nodes.map((n) => n.x + n.width)) - x,
    height: Math.max(...nodes.map((n) => n.y + n.height)) - y,
  }
}

export const insideGroup = (g: Bounds, n: Bounds) =>
  n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)

function mergeList<T extends { id: string }>(base: T[], local: T[], disk: T[]): T[] {
  const was = new Map(base.map((x) => [x.id, x]))
  const there = new Map(disk.map((x) => [x.id, x]))
  const here = new Set(local.map((x) => x.id))
  const out: T[] = []
  for (const item of local) {
    const before = was.get(item.id)
    const theirs = there.get(item.id)

    if (!before) out.push(item)
    else if (!theirs) {
      if (!same(item, before)) out.push(item)
    } else out.push(same(item, before) ? theirs : item)
  }
  for (const item of disk) if (!here.has(item.id) && !was.has(item.id)) out.push(item)
  return out
}

export function mergeBoards(base: BoardData, local: BoardData, disk: BoardData): BoardData {
  const nodes = mergeList(base.nodes, local.nodes, disk.nodes)
  const ids = new Set(nodes.map((n) => n.id))
  const edges = mergeList(base.edges, local.edges, disk.edges).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
  return { nodes, edges }
}

let seq = 0

export const boardItemId = () => `${Date.now().toString(36)}${(seq++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`
