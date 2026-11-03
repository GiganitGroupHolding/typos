import { boardBounds, type BoardData, type BoardNode } from "./model"

export function textSize(text: string, width = 260) {
  const perLine = Math.max(8, Math.floor((width - 28) / 8.5))
  const lines = text.split("\n").reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0)
  return { width, height: Math.max(60, lines * 22 + 32) }
}

const GAP = 80
const FRAME_PAD = 32

const LABEL_ROOM = 40

type Box = { x: number; y: number; width: number; height: number }

const hit = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

function origin(data: BoardData, placed: BoardNode[], fresh: Set<string>, block: Box, dir: "TB" | "LR", framed: boolean) {
  const below = boardBounds(placed)
  if (!below) return { x: 0, y: 0 }
  const fallback = { x: below.x, y: below.y + below.height + GAP + (framed ? LABEL_ROOM : 0) }
  const src = placed.find((p) => data.edges.some((e) => e.fromNode === p.id && fresh.has(e.toNode)))
  if (!src) return fallback

  const taken = placed.map((n) => ({
    x: n.x - 24,
    y: n.y - 24 - (n.type === "group" ? LABEL_ROOM : 0),
    width: n.width + 48,
    height: n.height + 48 + (n.type === "group" ? LABEL_ROOM : 0),
  }))
  const pad = framed ? LABEL_ROOM : 0
  let at = dir === "LR" ? { x: src.x + src.width + 90, y: src.y + pad } : { x: src.x, y: src.y + src.height + 90 + pad }
  for (let i = 0; i < 100; i++) {
    const box = { ...block, x: at.x, y: at.y - pad, height: block.height + pad }
    if (!taken.some((t) => hit(t, box))) return at
    at = dir === "LR" ? { ...at, y: at.y + 40 } : { ...at, x: at.x + 40 }
  }
  return fallback
}

export async function placeNodes(data: BoardData, unplaced: Set<string>, children: Map<string, string[]>, dir: "TB" | "LR" = "LR") {
  const frames = new Set([...children.keys()].filter((id) => unplaced.has(id)))
  const fresh = data.nodes.filter((n) => unplaced.has(n.id) && !frames.has(n.id))
  const freshIds = new Set(fresh.map((n) => n.id))

  const clusters = [...frames].filter((id) => children.get(id)!.every((c) => freshIds.has(c)))
  const placed = data.nodes.filter((n) => !unplaced.has(n.id))
  const at = new Map<string, Box>()

  if (fresh.length) {
    const { default: dagre } = await import("@dagrejs/dagre")
    const g = new dagre.graphlib.Graph({ multigraph: true, compound: true })
    g.setGraph({ rankdir: dir, nodesep: clusters.length ? 40 + LABEL_ROOM / 2 : 40, ranksep: 90, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const n of fresh) g.setNode(n.id, { width: n.width, height: n.height })
    for (const id of clusters) {
      g.setNode(id, {})

      for (const c of children.get(id)!) if (!g.parent(c)) g.setParent(c, id)
    }
    for (const e of data.edges) if (freshIds.has(e.fromNode) && freshIds.has(e.toNode)) g.setEdge(e.fromNode, e.toNode, {}, e.id)
    dagre.layout(g)
    const raw = [...fresh.map((n) => n.id), ...clusters].map((id) => {
      const p = g.node(id) as Box
      return { id, x: p.x - p.width / 2, y: p.y - p.height / 2, width: p.width, height: p.height }
    })
    const minX = Math.min(...raw.map((p) => p.x))
    const minY = Math.min(...raw.map((p) => p.y))
    const block = boardBounds(raw.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY })))!
    const { x: ox, y: oy } = origin(data, placed, freshIds, block, dir, frames.size > 0)
    for (const p of raw) at.set(p.id, { ...p, x: Math.round(p.x - minX + ox), y: Math.round(p.y - minY + oy) })
  }

  let nodes: BoardNode[] = data.nodes.map((n) => {
    const p = at.get(n.id)
    if (!p) return n
    return frames.has(n.id) ? { ...n, ...p, width: Math.round(p.width), height: Math.round(p.height) } : { ...n, x: p.x, y: p.y }
  })
  for (const id of frames) {
    if (at.has(id)) continue
    const b = boardBounds(nodes.filter((n) => children.get(id)!.includes(n.id)))
    if (!b) continue
    const frame = { x: b.x - FRAME_PAD, y: b.y - FRAME_PAD, width: b.width + FRAME_PAD * 2, height: b.height + FRAME_PAD * 2 }
    nodes = nodes.map((n) => (n.id === id ? { ...n, ...frame } : n))
  }
  return { ...data, nodes }
}
