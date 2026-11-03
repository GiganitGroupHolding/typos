export interface ParsedFlow {
  dir: "TB" | "BT" | "LR" | "RL"
  nodes: { id: string; text: string }[]
  edges: { from: string; to: string; label?: string }[]
}

const ID = /^[\p{L}\p{N}_]+/u

const SHAPES: [string, string][] = [
  ["(((", ")))"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[/", "\\]"],
  ["[\\", "/]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
]

const LABELLED = /^\s*<?(--|==|-\.)\s+(.+?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+)/

const LINK = /^\s*<?(-{2,}[>ox]?|={2,}[>ox]?|-\.+-+[>ox]?)(?:\s*\|([^|]*)\|)?/

const clean = (s: string) =>
  s
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/#quot;/g, '"')
    .replace(/[`*]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim()

export function parseFlowchart(code: string): ParsedFlow | null {
  const lines = code
    .replace(/%%.*$/gm, "")
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean)
  const head = lines.shift()?.match(/^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?\s*$/i)
  if (!head) return null
  const d = (head[1] ?? "TB").toUpperCase()
  const flow: ParsedFlow = { dir: d === "TD" ? "TB" : (d as ParsedFlow["dir"]), nodes: [], edges: [] }
  const texts = new Map<string, string>()

  const touch = (id: string, text?: string) => {
    if (text !== undefined) texts.set(id, text)
    else if (!texts.has(id)) texts.set(id, id)
  }

  const node = (s: string): { id: string; text?: string; rest: string } | null => {
    const m = s.match(ID)
    if (!m) return null
    let rest = s.slice(m[0].length)
    let text: string | undefined
    for (const [open, close] of SHAPES) {
      if (!rest.startsWith(open)) continue
      const body = rest.slice(open.length)
      const end = body.startsWith('"') ? body.indexOf(`"${close}`, 1) + 1 : body.indexOf(close)
      if (end < 0 || (body.startsWith('"') && end === 0)) continue
      text = clean(body.slice(0, end))
      rest = body.slice(end + close.length)
      break
    }
    rest = rest.replace(/^:::[\w-]+/, "")
    return { id: m[0], text, rest }
  }

  const group = (s: string): { ids: string[]; rest: string } | null => {
    const ids: string[] = []
    let rest = s
    for (;;) {
      const n = node(rest.trimStart())
      if (!n) return ids.length ? { ids, rest } : null
      touch(n.id, n.text)
      ids.push(n.id)
      rest = n.rest
      const amp = rest.match(/^\s*&\s*/)
      if (!amp) return { ids, rest }
      rest = rest.slice(amp[0].length)
    }
  }

  for (const line of lines) {
    if (/^(subgraph\b|end$|direction\b|classDef\b|class\s|style\s|linkStyle\b|click\s)/i.test(line)) continue
    let left = group(line)
    if (!left) continue
    let rest = left.rest
    for (;;) {
      const lab = rest.match(LABELLED)
      const lnk = lab ? null : rest.match(LINK)
      const hit = lab ?? lnk
      if (!hit) break
      const label = clean(lab ? lab[2] : (hit[2] ?? "")) || undefined
      const right = group(rest.slice(hit[0].length))
      if (!right) break
      for (const from of left.ids) for (const to of right.ids) if (from !== to) flow.edges.push({ from, to, label })
      left = right
      rest = right.rest
    }
  }
  flow.nodes = [...texts].map(([id, text]) => ({ id, text }))
  return flow.nodes.length ? flow : null
}

export interface LaidOut {
  nodes: { id: string; text: string; x: number; y: number; w: number; h: number }[]
  edges: { from: string; to: string; label?: string }[]
  width: number
  height: number
}

export type Measure = (text: string) => { w: number; h: number }

export function blockSize(text: string, lineWidth: (line: string) => number, max = 216): { w: number; h: number } {
  const lines: number[] = []
  for (const para of (text || " ").split("\n")) {
    let cur = ""
    for (const word of para.split(" ")) {
      const next = cur ? `${cur} ${word}` : word
      if (cur && lineWidth(next) > max) {
        lines.push(lineWidth(cur))
        cur = word
      } else cur = next
    }
    lines.push(lineWidth(cur))
  }
  return { w: Math.round(Math.min(248, Math.max(96, Math.max(...lines) + 32))), h: Math.round(lines.length * 20 + 24) }
}

export async function layoutFlow(flow: ParsedFlow, measure: Measure): Promise<LaidOut> {
  const { default: dagre } = await import("@dagrejs/dagre")
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: flow.dir, nodesep: 28, ranksep: 52, edgesep: 16, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of flow.nodes) {
    const s = measure(n.text)
    g.setNode(n.id, { width: s.w, height: s.h })
  }
  flow.edges.forEach((e, i) => {
    const lab = e.label ? measure(e.label) : null
    g.setEdge(e.from, e.to, lab ? { width: Math.max(0, lab.w - 24), height: 18, labelpos: "c" } : {}, `e${i}`)
  })
  dagre.layout(g)
  const nodes = flow.nodes.map((n) => {
    const p = g.node(n.id) as { x: number; y: number; width: number; height: number }
    return { id: n.id, text: n.text, x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height }
  })
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  for (const n of nodes) {
    n.x = Math.round(n.x - minX)
    n.y = Math.round(n.y - minY)
  }
  return {
    nodes,
    edges: flow.edges,
    width: Math.max(...nodes.map((n) => n.x + n.w)),
    height: Math.max(...nodes.map((n) => n.y + n.h)),
  }
}
