/*
 * Мини-карта конспекта: стеклянные блоки с текстом и стрелки поверх текста.
 * Лежит рядом с конспектом — `<Предмет>/Конспекты/.maps/<id конспекта>.json`, сам .md не трогается.
 * Координаты блока: x — от левого края колонки текста, y — от верха якоря группы (абзаца или скрытой схемы),
 * поэтому карта едет вместе с текстом, когда выше что-то дописали.
 */

export interface MapNode {
  id: string
  group: string
  x: number
  y: number
  w: number
  h: number
  text: string
}

export interface MapEdge {
  id: string
  from: string
  to: string
  label?: string
}

export type MapAnchor =
  /** переведённая схема mermaid: блок кода с таким хешем */
  | { kind: 'mermaid'; hash: string }
  /** абзац (или другой блок верхнего уровня): начало текста и номер, если таких несколько */
  | { kind: 'block'; text: string; index: number }
  /** якорь пропал — от верха текста */
  | { kind: 'abs'; y: number }

export interface MapGroup {
  id: string
  anchor: MapAnchor
  /** карту из схемы правили в приложении — при смене кода её не пересобираем */
  edited?: boolean
  /** последний известный отступ якоря от верха текста — на случай, если якорь удалят */
  lastY?: number
}

export interface NoteMap {
  version: 1
  groups: MapGroup[]
  nodes: MapNode[]
  edges: MapEdge[]
}

export const emptyMap = (): NoteMap => ({ version: 1, groups: [], nodes: [], edges: [] })

export const MIN_W = 40
export const MIN_H = 28

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

function anchorOf(v: unknown): MapAnchor | null {
  const a = v as Record<string, unknown> | null
  if (a?.kind === 'mermaid' && typeof a.hash === 'string') return { kind: 'mermaid', hash: a.hash }
  if (a?.kind === 'block') return { kind: 'block', text: str(a.text), index: num(a.index) }
  if (a?.kind === 'abs') return { kind: 'abs', y: num(a.y) }
  return null
}

type Raw = Record<string, unknown>
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === 'object') : [])

/** Файл карты → карта; битое и чужое отбрасывается, а не роняет конспект. */
export function parseNoteMap(text: string | null): NoteMap {
  let raw: Raw
  try {
    raw = text ? JSON.parse(text) : {}
  } catch {
    return emptyMap()
  }
  const map = emptyMap()
  for (const g of list(raw.groups)) {
    const anchor = anchorOf(g.anchor)
    if (typeof g.id !== 'string' || !anchor) continue
    map.groups.push({ id: g.id, anchor, edited: g.edited === true || undefined, lastY: typeof g.lastY === 'number' ? g.lastY : undefined })
  }
  const groups = new Set(map.groups.map((g) => g.id))
  for (const n of list(raw.nodes)) {
    if (typeof n.id !== 'string' || typeof n.group !== 'string' || !groups.has(n.group)) continue
    map.nodes.push({ id: n.id, group: n.group, x: num(n.x), y: num(n.y), w: Math.max(MIN_W, num(n.w, 140)), h: Math.max(MIN_H, num(n.h, 44)), text: str(n.text) })
  }
  const nodes = new Set(map.nodes.map((n) => n.id))
  for (const e of list(raw.edges)) {
    if (typeof e.id !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') continue
    if (!nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to) continue
    map.edges.push({ id: e.id, from: e.from, to: e.to, label: str(e.label) || undefined })
  }
  return map
}

export const serializeNoteMap = (map: NoteMap) => `${JSON.stringify(map, null, 1)}\n`

/** Текст карты для поиска. */
export const mapText = (map: NoteMap) => [...map.nodes.map((n) => n.text), ...map.edges.map((e) => e.label ?? '')].filter(Boolean).join('\n')

/** Хеш кода схемы: пробелы и переносы не важны. FNV-1a, 32 бита. */
export function codeHash(code: string): string {
  const s = code.replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

let seq = 0
export const mapId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Блок верхнего уровня, к которому привязана группа: по началу текста, при повторах — ближайший по номеру. */
export function resolveBlock(blocks: string[], anchor: { text: string; index: number }): number {
  if (!blocks.length) return -1
  const want = anchor.text.trim()
  if (want) {
    let best = -1
    blocks.forEach((t, i) => {
      if (blockKey(t).startsWith(want) && (best < 0 || Math.abs(i - anchor.index) < Math.abs(best - anchor.index))) best = i
    })
    if (best >= 0) return best
  }
  return Math.min(Math.max(anchor.index, 0), blocks.length - 1)
}

/** Начало текста блока для якоря. */
export const blockKey = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 40)
