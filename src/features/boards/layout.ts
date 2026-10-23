import { boardBounds, type BoardData, type BoardNode } from './model'

/** Размер карточки под текст: ширина фиксированная, высота — по примерному числу строк. */
export function textSize(text: string, width = 260) {
  const perLine = Math.max(8, Math.floor((width - 28) / 8.5))
  const lines = text.split('\n').reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0)
  return { width, height: Math.max(60, lines * 22 + 32) }
}

const GAP = 80
const FRAME_PAD = 32

/**
 * Расставляет узлы без координат (их присылает MCP): схема по стрелкам между ними (dagre), блоком под тем,
 * что уже есть на доске. Рамка с children встаёт вокруг своих узлов.
 */
export async function placeNodes(data: BoardData, unplaced: Set<string>, children: Map<string, string[]>, dir: 'TB' | 'LR' = 'LR') {
  const frames = new Set([...children.keys()].filter((id) => unplaced.has(id)))
  const fresh = data.nodes.filter((n) => unplaced.has(n.id) && !frames.has(n.id))
  const placed = data.nodes.filter((n) => !unplaced.has(n.id))
  const at = new Map<string, { x: number; y: number }>()

  if (fresh.length) {
    const { default: dagre } = await import('@dagrejs/dagre')
    const g = new dagre.graphlib.Graph({ multigraph: true })
    g.setGraph({ rankdir: dir, nodesep: 40, ranksep: 90, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const n of fresh) g.setNode(n.id, { width: n.width, height: n.height })
    const ids = new Set(fresh.map((n) => n.id))
    for (const e of data.edges) if (ids.has(e.fromNode) && ids.has(e.toNode)) g.setEdge(e.fromNode, e.toNode, {}, e.id)
    dagre.layout(g)
    const raw = fresh.map((n) => {
      const p = g.node(n.id) as { x: number; y: number }
      return { id: n.id, x: p.x - n.width / 2, y: p.y - n.height / 2 }
    })
    const minX = Math.min(...raw.map((p) => p.x))
    const minY = Math.min(...raw.map((p) => p.y))
    const below = boardBounds(placed)
    const ox = below ? below.x : 0
    // место под рамкой: её подпись над верхним краем
    const oy = below ? below.y + below.height + GAP + (frames.size ? FRAME_PAD : 0) : 0
    for (const p of raw) at.set(p.id, { x: Math.round(p.x - minX + ox), y: Math.round(p.y - minY + oy) })
  }

  let nodes: BoardNode[] = data.nodes.map((n) => (at.has(n.id) ? { ...n, ...at.get(n.id)! } : n))
  for (const id of frames) {
    const inside = nodes.filter((n) => children.get(id)!.includes(n.id))
    const b = boardBounds(inside)
    if (!b) continue
    const frame = { x: b.x - FRAME_PAD, y: b.y - FRAME_PAD, width: b.width + FRAME_PAD * 2, height: b.height + FRAME_PAD * 2 }
    nodes = nodes.map((n) => (n.id === id ? { ...n, ...frame } : n))
  }
  return { ...data, nodes }
}
