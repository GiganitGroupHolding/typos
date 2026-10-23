import { placeNodes, textSize } from '@/features/boards/layout'
import {
  boardItemId,
  isBoardColor,
  MIN_NODE_H,
  MIN_NODE_W,
  type BoardData,
  type BoardEdge,
  type BoardNode,
  type BoardNodeType,
} from '@/features/boards/model'

/** Узел доски от модели: всё необязательно; у существующего id — правка только переданных полей. */
export interface BoardNodeInput {
  id?: string
  type?: BoardNodeType
  text?: string
  label?: string
  url?: string
  file?: string
  color?: string
  x?: number
  y?: number
  width?: number
  height?: number
  /** у рамки без координат — id узлов, вокруг которых она встанет */
  children?: string[]
}

export interface BoardEdgeInput {
  id?: string
  from?: string
  to?: string
  label?: string
  color?: string
  arrow?: 'end' | 'both' | 'none'
}

export interface BoardEdit {
  nodes?: BoardNodeInput[]
  edges?: BoardEdgeInput[]
  /** id узлов и стрелок; стрелки удалённых узлов уходят с ними */
  remove?: string[]
  /** куда идёт схема у расставляемых узлов */
  direction?: 'LR' | 'TB'
}

const NAMED: Record<string, string> = { red: '1', orange: '2', yellow: '3', green: '4', cyan: '5', blue: '5', purple: '6', violet: '6' }

/** Цвет от модели: пресет, имя по-английски или #rrggbb; «» — без цвета. */
function color(v: string | undefined, where: string): string | undefined | null {
  if (v === undefined) return null
  const c = NAMED[v.trim().toLowerCase()] ?? v.trim()
  if (!c) return undefined
  if (!isBoardColor(c)) throw new Error(`${where}: цвет «${v}» — нужен 1…6 (красный … фиолетовый) или #rrggbb`)
  return c
}

/** Путь к картинке внутри хранилища — как его проверяют адаптеры, только раньше и с понятной ошибкой. */
function imagePath(file: string) {
  const parts = file.split('/')
  if (file.startsWith('/') || /[\\:]/.test(file) || parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.')))
    throw new Error(`Картинка «${file}»: нужен путь внутри хранилища, как в ответе add_image (path)`)
  if (!/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(file)) throw new Error(`«${file}» — не картинка`)
  return file
}

function url(v: string) {
  if (!/^https?:\/\/\S+$/i.test(v.trim())) throw new Error(`Ссылка «${v}»: нужен адрес http(s)://…`)
  return v.trim()
}

const DEFAULT_SIZE: Record<BoardNodeType, { width: number; height: number }> = {
  text: { width: 260, height: 80 },
  group: { width: 560, height: 380 },
  link: { width: 320, height: 60 },
  file: { width: 320, height: 240 },
}

const size = (v: number | undefined, min: number) => (v === undefined ? undefined : Math.max(min, Math.round(v)))

/**
 * Правка доски от MCP: добавить или поправить узлы и стрелки, удалить по id, расставить узлы без координат.
 * Возвращает новые данные и id узлов в порядке nodes (для стрелок в следующих вызовах).
 */
export async function editBoard(data: BoardData, edit: BoardEdit): Promise<{ data: BoardData; ids: string[] }> {
  const gone = new Set(edit.remove ?? [])
  let nodes = data.nodes.filter((n) => !gone.has(n.id))
  let edges = data.edges.filter((e) => !gone.has(e.id) && !gone.has(e.fromNode) && !gone.has(e.toNode))
  const unplaced = new Set<string>()
  const children = new Map<string, string[]>()
  const ids: string[] = []

  for (const [i, input] of (edit.nodes ?? []).entries()) {
    const where = `Узел ${input.id ?? i + 1}`
    const existing = input.id ? nodes.find((n) => n.id === input.id) : undefined
    const c = color(input.color, where)
    if (existing) {
      const next: BoardNode = { ...existing }
      if (input.text !== undefined) next.text = input.text
      if (input.label !== undefined) next.label = input.label || undefined
      if (input.url !== undefined) next.url = url(input.url)
      if (input.file !== undefined) next.file = imagePath(input.file)
      if (c !== null) next.color = c
      if (input.x !== undefined) next.x = Math.round(input.x)
      if (input.y !== undefined) next.y = Math.round(input.y)
      next.width = size(input.width, MIN_NODE_W) ?? next.width
      // текст стал длиннее, а размер не задан — карточка растёт под него
      next.height =
        size(input.height, MIN_NODE_H) ??
        (next.type === 'text' && input.text !== undefined ? Math.max(next.height, textSize(input.text, next.width).height) : next.height)
      nodes = nodes.map((n) => (n.id === next.id ? next : n))
      ids.push(next.id)
      continue
    }
    const type: BoardNodeType =
      input.type ?? (input.url ? 'link' : input.file ? 'file' : input.children || (input.label && !input.text) ? 'group' : 'text')
    const id = input.id && !edges.some((e) => e.id === input.id) ? input.id : boardItemId()
    const fit = type === 'text' ? textSize(input.text ?? '', size(input.width, MIN_NODE_W)) : DEFAULT_SIZE[type]
    const node: BoardNode = {
      id,
      type,
      x: Math.round(input.x ?? 0),
      y: Math.round(input.y ?? 0),
      width: size(input.width, MIN_NODE_W) ?? fit.width,
      height: size(input.height, MIN_NODE_H) ?? fit.height,
      color: c ?? undefined,
      text: type === 'text' ? (input.text ?? '') : undefined,
      label: type === 'group' ? input.label || undefined : undefined,
      url: type === 'link' ? url(input.url ?? '') : undefined,
      file: type === 'file' ? imagePath(input.file ?? '') : undefined,
    }
    if (input.x === undefined || input.y === undefined) unplaced.add(id)
    if (type === 'group' && input.children?.length) children.set(id, input.children)
    // рамки — первыми: они под карточками
    nodes = type === 'group' ? [node, ...nodes] : [...nodes, node]
    ids.push(id)
  }

  const known = new Set(nodes.map((n) => n.id))
  for (const [i, input] of (edit.edges ?? []).entries()) {
    const where = `Стрелка ${input.id ?? `${input.from} → ${input.to}`}`
    const existing = input.id ? edges.find((e) => e.id === input.id) : undefined
    const from = input.from ?? existing?.fromNode
    const to = input.to ?? existing?.toNode
    if (!from || !to) throw new Error(`Стрелка ${i + 1}: нужны from и to — id узлов`)
    for (const end of [from, to]) if (!known.has(end)) throw new Error(`${where}: нет узла «${end}»`)
    if (from === to) throw new Error(`${where}: начало и конец — один узел`)
    const c = color(input.color, where)
    const next: BoardEdge = {
      ...(existing ?? { id: input.id && !known.has(input.id) ? input.id : boardItemId() }),
      fromNode: from,
      toNode: to,
    }
    if (input.label !== undefined) next.label = input.label || undefined
    if (c !== null) next.color = c
    if (input.arrow) {
      next.fromEnd = input.arrow === 'both' ? 'arrow' : undefined
      next.toEnd = input.arrow === 'none' ? 'none' : undefined
    }
    edges = existing ? edges.map((e) => (e.id === existing.id ? next : e)) : [...edges, next]
  }

  for (const [id, list] of children) {
    const missing = list.filter((c) => !known.has(c))
    if (missing.length) throw new Error(`Рамка ${id}: нет узлов ${missing.join(', ')}`)
  }
  const result = { nodes, edges }
  return { data: unplaced.size ? await placeNodes(result, unplaced, children, edit.direction) : result, ids }
}

/** Доска для ответа модели: без пустых полей. */
export function boardForModel(data: BoardData) {
  return {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      ...(n.text !== undefined ? { text: n.text } : {}),
      ...(n.label ? { label: n.label } : {}),
      ...(n.url ? { url: n.url } : {}),
      ...(n.file ? { file: n.file } : {}),
      ...(n.color ? { color: n.color } : {}),
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    edges: data.edges.map((e) => ({
      id: e.id,
      from: e.fromNode,
      to: e.toNode,
      ...(e.label ? { label: e.label } : {}),
      ...(e.color ? { color: e.color } : {}),
      ...(e.fromEnd === 'arrow' ? { arrow: 'both' } : e.toEnd === 'none' ? { arrow: 'none' } : {}),
    })),
  }
}
