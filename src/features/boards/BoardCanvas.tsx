import { ExternalLink, FileText, Link2 } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { toast } from 'sonner'
import { clamp, contains, curve, edgePath, facingSides, rectOf, sidePoint, type Rect, type Side } from '@/editor/map/geometry'
import { errorText } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { basename } from '@/storage/VaultAdapter'
import type { Board } from '@/types'
import { useVault, vaultFileUrl } from '@/vault/store'
import { BoardText } from './BoardText'
import { BoardToolbar, SelectionBar, type BoardTool } from './BoardToolbar'
import { textSize } from './layout'
import {
  boardBounds,
  boardItemId,
  insideGroup,
  mergeBoards,
  MIN_NODE_H,
  MIN_NODE_W,
  serializeBoard,
  type BoardData,
  type BoardEdge,
  type BoardNode,
} from './model'

/*
 * Доска: бесконечное полотно. Колесо — прокрутка, Ctrl + колесо (щипок на тачпаде) — масштаб,
 * пробел, средняя кнопка или «Рука» — двигать полотно. Протянуть по пустому — выделить рамкой,
 * двойной щелчок по пустому — стикер, по карточке — текст. Точка на краю карточки — стрелка
 * (в пустоту — новая связанная карточка). Ctrl Z / Ctrl Shift Z, Ctrl D, Ctrl C / Ctrl V, Delete.
 */

type Pt = { x: number; y: number }
interface View {
  x: number
  y: number
  zoom: number
}
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: string[] }
  | { kind: 'move'; id: string; sx: number; sy: number; starts: Map<string, Pt>; moved: boolean; shift: boolean }
  | { kind: 'resize'; id: string; sx: number; sy: number; w: number; h: number }
  | { kind: 'connect'; from: string; side: Side; x: number; y: number }
  | { kind: 'draw'; tool: 'sticky' | 'text' | 'frame'; x0: number; y0: number; x1: number; y1: number }
type Editing = { kind: 'node' | 'edge'; id: string; fresh?: boolean } | null

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const SAVE_DELAY = 500
const CLIP_MARK = 'typos-board'
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i

const NEW: Record<'sticky' | 'text' | 'frame', Omit<BoardNode, 'id' | 'x' | 'y'>> = {
  sticky: { type: 'text', width: 200, height: 200, color: '3', text: '' },
  text: { type: 'text', width: 260, height: 80, text: '' },
  frame: { type: 'group', width: 560, height: 380, label: 'Рамка' },
}

const rect = (n: BoardNode): Rect => ({ x: n.x, y: n.y, w: n.width, h: n.height })
const bounds = (n: BoardNode) => ({ x: n.x, y: n.y, width: n.width, height: n.height })
const preset = (c?: string) => !!c && /^[1-6]$/.test(c)

/** Цвет линии: пресет, свой #rrggbb или приглушённый по умолчанию. */
const lineColor = (c?: string) => (preset(c) ? `var(--board-line-${c})` : c || 'var(--muted-foreground)')

function nodeStyle(n: BoardNode): CSSProperties {
  if (n.type === 'group') {
    const line = n.color ? lineColor(n.color) : 'var(--foreground)'
    return {
      background: `color-mix(in oklab, ${line} ${n.color ? 9 : 3}%, transparent)`,
      borderColor: `color-mix(in oklab, ${line} ${n.color ? 55 : 22}%, transparent)`,
    }
  }
  if (!n.color) return {}
  return preset(n.color)
    ? { background: `var(--board-${n.color})`, borderColor: 'transparent' }
    : { background: `color-mix(in oklab, ${n.color} 28%, var(--card))`, borderColor: n.color }
}

function edgeGeometry(e: BoardEdge, a: BoardNode, b: BoardNode) {
  if (!e.fromSide && !e.toSide) return edgePath(rect(a), rect(b))
  const [fa, fb] = facingSides(rect(a), rect(b))
  const from = e.fromSide ?? fa
  const to = e.toSide ?? fb
  return curve(sidePoint(rect(a), from), from, sidePoint(rect(b), to), to)
}

async function imageSize(file: Blob) {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 420 / Math.max(bmp.width, bmp.height))
    return { width: Math.max(MIN_NODE_W, Math.round(bmp.width * k)), height: Math.max(MIN_NODE_H, Math.round(bmp.height * k)) }
  } catch {
    return { width: 320, height: 240 }
  }
}

/** Новые id для вставки копий; стрелки — только между скопированными. */
function cloneItems(nodes: BoardNode[], edges: BoardEdge[], dx: number, dy: number) {
  const ids = new Map(nodes.map((n) => [n.id, boardItemId()]))
  return {
    nodes: nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: n.x + dx, y: n.y + dy })),
    edges: edges
      .filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
      .map((e) => ({ ...e, id: boardItemId(), fromNode: ids.get(e.fromNode)!, toNode: ids.get(e.toNode)! })),
  }
}

export function BoardCanvas({ board }: { board: Board }) {
  const root = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [data, setDataState] = useState(board.data)
  const dataRef = useRef(board.data)
  const past = useRef<BoardData[]>([])
  const future = useRef<BoardData[]>([])
  const saveTimer = useRef(0)
  const [view, setViewState] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const viewRef = useRef(view)
  const [tool, setTool] = useState<BoardTool>('select')
  const [sel, setSel] = useState<string[]>([])
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const pointer = useRef<Pt | null>(null)
  const touches = useRef(new Map<number, Pt>())
  const pinch = useRef<{ d: number; mid: Pt; view: View } | null>(null)
  const boardId = board.id

  const setView = (v: View) => {
    viewRef.current = v
    setViewState(v)
  }
  const setDrag = (d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }

  // ---------- сохранение ----------

  const flush = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = 0
    const sent = dataRef.current
    void useVault
      .getState()
      .saveBoard(boardId, sent)
      .then(
        (next) => {
          if (!next || next === sent) return
          // в файле были правки снаружи — их слили; здесь за это время могли добавить своё
          const cur = dataRef.current
          const merged = cur === sent ? next : mergeBoards(sent, cur, next)
          dataRef.current = merged
          setDataState(merged)
        },
        (e) => toast.error('Доска не сохранилась', { id: 'board-save', description: errorText(e) }),
      )
  }, [boardId])

  const commit = useCallback(
    (next: BoardData, record = true) => {
      if (record) {
        past.current = [...past.current.slice(-99), dataRef.current]
        future.current = []
      }
      dataRef.current = next
      setDataState(next)
      clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(flush, SAVE_DELAY)
    },
    [flush],
  )

  useEffect(() => {
    useVault.getState().adoptBoard(boardId, dataRef.current)
    // доску поменяли снаружи (MCP, другое устройство) — показываем, если здесь нет несохранённого
    const off = useVault.subscribe((s, prev) => {
      const next = s.boards.find((b) => b.id === boardId)?.data
      if (!next || next === prev.boards.find((b) => b.id === boardId)?.data) return
      if (saveTimer.current || next === dataRef.current) return
      if (serializeBoard(boardId, next) === serializeBoard(boardId, dataRef.current)) return
      useVault.getState().adoptBoard(boardId, next)
      dataRef.current = next
      past.current = []
      future.current = []
      setDataState(next)
      const ids = new Set(next.nodes.map((n) => n.id))
      setSel((cur) => cur.filter((id) => ids.has(id)))
    })
    const onHide = () => document.visibilityState === 'hidden' && saveTimer.current && flush()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      off()
      document.removeEventListener('visibilitychange', onHide)
      if (saveTimer.current) flush()
    }
  }, [boardId, flush])

  // ---------- вид ----------

  const fit = useCallback(() => {
    const el = root.current
    if (!el) return
    const b = boardBounds(dataRef.current.nodes)
    const w = el.clientWidth
    const h = el.clientHeight
    if (!b) return setView({ x: w / 2, y: h / 2, zoom: 1 })
    const zoom = clamp(Math.min((w - 120) / b.width, (h - 160) / b.height), MIN_ZOOM, 1)
    setView({ zoom, x: w / 2 - (b.x + b.width / 2) * zoom, y: h / 2 - (b.y + b.height / 2) * zoom })
  }, [])

  useLayoutEffect(fit, [fit])

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = root.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toWorld = (p: Pt): Pt => {
    const v = viewRef.current
    return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom }
  }
  const world = (e: { clientX: number; clientY: number }) => toWorld(local(e))
  const center = () => {
    const el = root.current!
    return toWorld({ x: el.clientWidth / 2, y: el.clientHeight / 2 })
  }

  const zoomAt = useCallback((p: Pt, factor: number) => {
    const v = viewRef.current
    const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const k = zoom / v.zoom
    setView({ zoom, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k })
  }, [])

  const zoomBy = (factor: number | 'reset') => {
    const el = root.current!
    const mid = { x: el.clientWidth / 2, y: el.clientHeight / 2 }
    zoomAt(mid, factor === 'reset' ? 1 / viewRef.current.zoom : factor)
  }

  // колесо: React вешает его пассивным, а preventDefault нужен, чтобы страница не масштабировалась
  useEffect(() => {
    const el = root.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('textarea') && !e.ctrlKey) return
      e.preventDefault()
      const p = local(e)
      if (e.ctrlKey || e.metaKey) zoomAt(p, Math.exp(-e.deltaY * (e.deltaMode ? 0.04 : 0.0025)))
      else {
        const v = viewRef.current
        const k = e.deltaMode ? 16 : 1
        setView({ ...v, x: v.x - e.deltaX * k, y: v.y - e.deltaY * k })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // ---------- правки ----------

  const node = (id: string) => dataRef.current.nodes.find((n) => n.id === id)

  const addNodes = (nodes: BoardNode[], edges: BoardEdge[] = []) => {
    const m = dataRef.current
    commit({ nodes: [...m.nodes, ...nodes], edges: [...m.edges, ...edges] })
    setSel(nodes.map((n) => n.id))
    setSelEdge(null)
  }

  const create = (kind: 'sticky' | 'text' | 'frame', at: Pt, size?: { width: number; height: number }) => {
    const base = NEW[kind]
    const width = size?.width ?? base.width
    const height = size?.height ?? base.height
    const n: BoardNode = {
      ...base,
      id: boardItemId(),
      width,
      height,
      x: Math.round(at.x - (size ? 0 : width / 2)),
      y: Math.round(at.y - (size ? 0 : height / 2)),
    }
    addNodes([n])
    setTool('select')
    if (n.type === 'text') setEditing({ kind: 'node', id: n.id, fresh: true })
    return n
  }

  const removeSelection = () => {
    const m = dataRef.current
    if (selEdge) commit({ ...m, edges: m.edges.filter((e) => e.id !== selEdge) })
    else if (sel.length) {
      const gone = new Set(sel)
      commit({ nodes: m.nodes.filter((n) => !gone.has(n.id)), edges: m.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)) })
    }
    setSel([])
    setSelEdge(null)
  }

  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(dataRef.current)
    commit(prev, false)
    setEditing(null)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(dataRef.current)
    commit(next, false)
    setEditing(null)
  }

  const selectedItems = () => {
    const m = dataRef.current
    const ids = new Set(sel)
    return { nodes: m.nodes.filter((n) => ids.has(n.id)), edges: m.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) }
  }

  const duplicate = () => {
    const { nodes, edges } = selectedItems()
    if (!nodes.length) return
    const copy = cloneItems(nodes, edges, 24, 24)
    addNodes(copy.nodes, copy.edges)
  }

  const setColor = (color: string | undefined) => {
    const m = dataRef.current
    if (selEdge) return commit({ ...m, edges: m.edges.map((e) => (e.id === selEdge ? { ...e, color } : e)) })
    const ids = new Set(sel)
    commit({ ...m, nodes: m.nodes.map((n) => (ids.has(n.id) ? { ...n, color } : n)) })
  }

  /** Концы стрелки по кругу: к концу → в обе стороны → без стрелок. */
  const cycleArrows = () => {
    const m = dataRef.current
    commit({
      ...m,
      edges: m.edges.map((e) => {
        if (e.id !== selEdge) return e
        if (e.fromEnd === 'arrow') return { ...e, fromEnd: undefined, toEnd: 'none' as const }
        if (e.toEnd === 'none') return { ...e, fromEnd: undefined, toEnd: undefined }
        return { ...e, fromEnd: 'arrow' as const, toEnd: undefined }
      }),
    })
  }

  const toFront = () => {
    const m = dataRef.current
    const ids = new Set(sel)
    commit({ ...m, nodes: [...m.nodes.filter((n) => !ids.has(n.id)), ...m.nodes.filter((n) => ids.has(n.id))] })
  }

  const addImages = async (files: File[], at: Pt) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return false
    try {
      const nodes: BoardNode[] = []
      for (const [i, f] of images.entries()) {
        const size = await imageSize(f)
        const file = await useVault.getState().saveBoardImage(boardId, f)
        nodes.push({
          id: boardItemId(),
          type: 'file',
          file,
          ...size,
          x: Math.round(at.x - size.width / 2 + i * 32),
          y: Math.round(at.y - size.height / 2 + i * 32),
        })
      }
      addNodes(nodes)
    } catch (e) {
      toast.error('Не удалось добавить картинку', { description: errorText(e) })
    }
    return true
  }

  // ---------- мышь ----------

  const nodeAt = (all: BoardNode[], p: Pt, except?: string) => {
    const nodes = [...all].reverse().filter((n) => n.id !== except)
    return nodes.find((n) => n.type !== 'group' && contains(rect(n), p, 6)) ?? nodes.find((n) => n.type === 'group' && contains(rect(n), p))
  }

  const startPan = (e: ReactPointerEvent) => {
    const v = viewRef.current
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-editor]')) return
    root.current?.focus({ preventScroll: true })
    root.current?.setPointerCapture(e.pointerId)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, local(e))
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current }
        setDrag(null)
        return
      }
    }
    const nodeEl = target.closest<HTMLElement>('[data-node-id]')
    const edgeEl = target.closest<Element>('[data-edge-id]')
    const onEmpty = !nodeEl && !edgeEl
    if (
      e.button === 1 ||
      (e.button === 0 && (tool === 'hand' || spaceHeld)) ||
      (e.pointerType === 'touch' && onEmpty && tool === 'select')
    ) {
      e.preventDefault()
      return startPan(e)
    }
    if (e.button !== 0) return
    e.preventDefault()
    const p = world(e)

    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!
      const n = node(id)
      if (!n) return
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as Side | undefined
      if (handle) return setDrag({ kind: 'connect', from: id, side: handle, x: p.x, y: p.y })
      if (target.closest('[data-resize]')) {
        past.current = [...past.current.slice(-99), dataRef.current]
        future.current = []
        return setDrag({ kind: 'resize', id, sx: p.x, sy: p.y, w: n.width, h: n.height })
      }
      const next = e.shiftKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : sel.includes(id) ? sel : [id]
      setSel(next)
      setSelEdge(null)
      // рамка тянет за собой всё, что лежит в ней целиком
      const starts = new Map<string, Pt>()
      for (const sid of next) {
        const s = node(sid)
        if (!s) continue
        starts.set(sid, { x: s.x, y: s.y })
        if (s.type === 'group')
          for (const c of dataRef.current.nodes) if (c.id !== sid && insideGroup(bounds(s), bounds(c))) starts.set(c.id, { x: c.x, y: c.y })
      }
      return setDrag({ kind: 'move', id, sx: p.x, sy: p.y, starts, moved: false, shift: e.shiftKey })
    }
    if (edgeEl) {
      setSelEdge(edgeEl.getAttribute('data-edge-id'))
      setSel([])
      return
    }
    setEditing(null)
    if (tool === 'sticky' || tool === 'text' || tool === 'frame') return setDrag({ kind: 'draw', tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    setSelEdge(null)
    setSel(e.shiftKey ? sel : [])
    setDrag({ kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: e.shiftKey ? sel : [] })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = world(e)
    pointer.current = p
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, local(e))
      const pz = pinch.current
      if (pz && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const zoom = clamp(pz.view.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pz.d), MIN_ZOOM, MAX_ZOOM)
        const k = zoom / pz.view.zoom
        setView({ zoom, x: mid.x - (pz.mid.x - pz.view.x) * k, y: mid.y - (pz.mid.y - pz.view.y) * k })
        return
      }
    }
    const d = dragRef.current
    if (!d) return
    const m = dataRef.current
    if (d.kind === 'pan') setView({ ...viewRef.current, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy })
    else if (d.kind === 'marquee') {
      setDrag({ ...d, x1: p.x, y1: p.y })
      const r = rectOf(d.x0, d.y0, p.x, p.y)
      const box = { x: r.x, y: r.y, width: r.w, height: r.h }
      const hit = m.nodes
        .filter((n) =>
          n.type === 'group'
            ? insideGroup(box, bounds(n))
            : n.x < r.x + r.w && n.x + n.width > r.x && n.y < r.y + r.h && n.y + n.height > r.y,
        )
        .map((n) => n.id)
      setSel([...new Set([...d.base, ...hit])])
    } else if (d.kind === 'move') {
      const dx = p.x - d.sx
      const dy = p.y - d.sy
      if (!d.moved) {
        if (Math.hypot(dx, dy) * viewRef.current.zoom < 3) return
        past.current = [...past.current.slice(-99), m]
        future.current = []
        dragRef.current = { ...d, moved: true }
      }
      commit(
        {
          ...m,
          nodes: m.nodes.map((n) =>
            d.starts.has(n.id) ? { ...n, x: Math.round(d.starts.get(n.id)!.x + dx), y: Math.round(d.starts.get(n.id)!.y + dy) } : n,
          ),
        },
        false,
      )
    } else if (d.kind === 'resize') {
      const width = Math.round(Math.max(MIN_NODE_W, d.w + p.x - d.sx))
      const height = Math.round(Math.max(MIN_NODE_H, d.h + p.y - d.sy))
      commit({ ...m, nodes: m.nodes.map((n) => (n.id === d.id ? { ...n, width, height } : n)) }, false)
    } else if (d.kind === 'connect') setDrag({ ...d, x: p.x, y: p.y })
    else setDrag({ ...d, x1: p.x, y1: p.y })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
    const d = dragRef.current
    setDrag(null)
    if (!d) return
    const p = world(e)
    const m = dataRef.current
    // щелчок без переноса по одной из выделенных — выделить только её
    if (d.kind === 'move' && !d.moved && !d.shift && sel.length > 1) setSel([d.id])
    if (d.kind === 'connect') {
      const target = nodeAt(m.nodes, p, d.from)
      if (target) {
        if (m.edges.some((x) => (x.fromNode === d.from && x.toNode === target.id) || (x.toNode === d.from && x.fromNode === target.id)))
          return
        commit({ ...m, edges: [...m.edges, { id: boardItemId(), fromNode: d.from, toNode: target.id }] })
        return
      }
      const from = node(d.from)
      if (!from) return
      const start = sidePoint(rect(from), d.side)
      if (Math.hypot(p.x - start.x, p.y - start.y) * viewRef.current.zoom < 24) return
      // в пустоту — новая карточка того же вида, как в майнд-карте
      const like = from.type === 'text' ? { width: from.width, height: Math.min(from.height, 200), color: from.color } : {}
      const n: BoardNode = { ...NEW.text, ...like, id: boardItemId(), x: 0, y: 0 }
      n.x = Math.round(p.x - n.width / 2)
      n.y = Math.round(p.y - n.height / 2)
      addNodes([n], [{ id: boardItemId(), fromNode: d.from, toNode: n.id }])
      setEditing({ kind: 'node', id: n.id, fresh: true })
    } else if (d.kind === 'draw') {
      const r = rectOf(d.x0, d.y0, d.x1, d.y1)
      const big = r.w * viewRef.current.zoom > 12 && r.h * viewRef.current.zoom > 12
      create(
        d.tool,
        big ? { x: r.x, y: r.y } : { x: d.x0, y: d.y0 },
        big ? { width: Math.max(MIN_NODE_W, r.w), height: Math.max(MIN_NODE_H, r.h) } : undefined,
      )
    }
  }

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // полотно захватывает указатель, и браузер отдаёт dblclick ему самому — что под мышью, смотрим по точке
    const target = (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement
    if (target.closest('[data-editor]')) return
    const nodeEl = target.closest<HTMLElement>('[data-node-id]')
    const edgeEl = target.closest<Element>('[data-edge-id]')
    if (nodeEl) {
      const n = node(nodeEl.dataset.nodeId!)
      if (n && n.type !== 'file') setEditing({ kind: 'node', id: n.id })
    } else if (edgeEl) setEditing({ kind: 'edge', id: edgeEl.getAttribute('data-edge-id')! })
    else if (tool === 'select') create('sticky', world(e))
  }

  const finishEdit = (value: string, height?: number) => {
    const ed = editing
    setEditing(null)
    root.current?.focus({ preventScroll: true })
    if (!ed) return
    const m = dataRef.current
    if (ed.kind === 'edge') {
      const label = value.trim() || undefined
      if (m.edges.find((x) => x.id === ed.id)?.label !== label)
        commit({ ...m, edges: m.edges.map((x) => (x.id === ed.id ? { ...x, label } : x)) })
      return
    }
    const n = m.nodes.find((x) => x.id === ed.id)
    if (!n) return
    if (n.type === 'text') {
      const text = value.replace(/\s+$/, '')
      if (!text.trim() && ed.fresh) {
        // пустая новая карточка не нужна — и в истории её не оставляем
        past.current.pop()
        commit(
          { nodes: m.nodes.filter((x) => x.id !== n.id), edges: m.edges.filter((x) => x.fromNode !== n.id && x.toNode !== n.id) },
          false,
        )
        setSel([])
        return
      }
      const h = Math.max(n.height, Math.ceil(height ?? 0))
      if (text !== n.text || h !== n.height)
        commit({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, text, height: h } : x)) }, !ed.fresh)
    } else {
      const key = n.type === 'group' ? 'label' : 'url'
      const v = value.trim() || undefined
      if (n[key] !== v) commit({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, [key]: v } : x)) })
    }
  }

  // ---------- клавиатура и буфер обмена ----------

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || (e.target as HTMLElement).closest('[data-editor]')) return
    const ctrl = e.ctrlKey || e.metaKey
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.code === 'Space') {
      stop()
      if (!e.repeat) setSpaceHeld(true)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      stop()
      removeSelection()
    } else if (ctrl && e.code === 'KeyZ') {
      stop()
      if (e.shiftKey) redo()
      else undo()
    } else if (ctrl && e.code === 'KeyY') {
      stop()
      redo()
    } else if (ctrl && e.code === 'KeyD') {
      stop()
      duplicate()
    } else if (ctrl && e.code === 'KeyA') {
      stop()
      setSel(dataRef.current.nodes.map((n) => n.id))
      setSelEdge(null)
    } else if (e.key === 'Escape') {
      stop()
      setSel([])
      setSelEdge(null)
      setTool('select')
    } else if (e.key === 'Enter' && (sel.length === 1 || selEdge)) {
      stop()
      const n = sel.length === 1 ? node(sel[0]) : undefined
      if (selEdge) setEditing({ kind: 'edge', id: selEdge })
      else if (n && n.type !== 'file') setEditing({ kind: 'node', id: n.id })
    } else if (e.shiftKey && e.code === 'Digit1') {
      stop()
      fit()
    } else if (e.shiftKey && e.code === 'Digit0') {
      stop()
      zoomBy('reset')
    } else if (sel.length && e.key.startsWith('Arrow')) {
      stop()
      const step = e.shiftKey ? 20 : 4
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      const ids = new Set(sel)
      const m = dataRef.current
      commit({ ...m, nodes: m.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) })
    } else if (!ctrl && !e.altKey) {
      const t = ({ KeyV: 'select', KeyH: 'hand', KeyS: 'sticky', KeyT: 'text', KeyF: 'frame' } as const)[e.code as 'KeyV']
      if (t) {
        stop()
        setTool(t)
      }
    }
  }

  // copy/paste без выделенного текста приходят на body, а не на полотно — слушаем окно
  useEffect(() => {
    const active = () => !!root.current?.contains(document.activeElement) && !document.activeElement?.closest('[data-editor]')
    const onCopy = (e: ClipboardEvent) => {
      if (!active() || !sel.length) return
      const { nodes, edges } = selectedItems()
      e.preventDefault()
      e.clipboardData?.setData('text/plain', JSON.stringify({ [CLIP_MARK]: 1, nodes, edges }))
      if (e.type === 'cut') removeSelection()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!active() || !e.clipboardData) return
      e.preventDefault()
      const at = pointer.current ?? center()
      const files = [...e.clipboardData.files]
      if (files.length) return void addImages(files, at)
      const text = e.clipboardData.getData('text/plain')
      if (!text.trim()) return
      try {
        const clip = JSON.parse(text) as { [CLIP_MARK]?: number; nodes?: BoardNode[]; edges?: BoardEdge[] }
        if (clip[CLIP_MARK] && Array.isArray(clip.nodes)) {
          const b = boardBounds(clip.nodes)
          if (!b) return
          const parsed = clip.nodes.filter((n) => typeof n.id === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))
          const copy = cloneItems(
            parsed,
            Array.isArray(clip.edges) ? clip.edges : [],
            Math.round(at.x - b.x - b.width / 2),
            Math.round(at.y - b.y - b.height / 2),
          )
          return addNodes(copy.nodes, copy.edges)
        }
      } catch {
        // обычный текст — карточкой
      }
      const size = textSize(text.trim())
      addNodes([
        {
          id: boardItemId(),
          type: 'text',
          text: text.trim(),
          ...size,
          x: Math.round(at.x - size.width / 2),
          y: Math.round(at.y - size.height / 2),
        },
      ])
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCopy)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCopy)
      window.removeEventListener('paste', onPaste)
    }
  })

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const files = [...e.dataTransfer.files]
    if (!files.some((f) => f.type.startsWith('image/'))) return
    e.preventDefault()
    e.stopPropagation()
    void addImages(files, world(e))
  }

  // ---------- рисование ----------

  const ordered = useMemo(
    () => [...data.nodes.filter((n) => n.type === 'group'), ...data.nodes.filter((n) => n.type !== 'group')],
    [data.nodes],
  )
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])
  const markers = useMemo(() => [...new Set([...data.edges.map((e) => e.color ?? ''), '', 'sel'])], [data.edges])
  const marker = (key: string) => `url(#b${boardId}-${key || 'none'})`

  const grid = 24 * view.zoom * (view.zoom < 0.4 ? 4 : 1)
  const d = drag
  const single = sel.length === 1 ? sel[0] : null
  const editedEdge = editing?.kind === 'edge' ? data.edges.find((x) => x.id === editing.id) : undefined
  const selectedEdge = selEdge ? data.edges.find((x) => x.id === selEdge) : undefined
  const selColors = new Set(sel.map((id) => byId.get(id)?.color))
  const panning = tool === 'hand' || spaceHeld || d?.kind === 'pan'

  return (
    <div
      ref={root}
      data-board-canvas=""
      tabIndex={0}
      role="application"
      aria-label={`Доска «${board.name}»`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        touches.current.delete(e.pointerId)
        pinch.current = null
        setDrag(null)
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.code === 'Space' && setSpaceHeld(false)}
      onBlur={() => setSpaceHeld(false)}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={onDrop}
      style={{
        backgroundImage: 'radial-gradient(circle, var(--board-dot) 1px, transparent 1.3px)',
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      className={cn(
        'relative size-full touch-none overflow-hidden outline-none select-none',
        panning ? (d?.kind === 'pan' ? 'cursor-grabbing' : 'cursor-grab') : tool !== 'select' && 'cursor-crosshair',
      )}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, '--inv': 1 / view.zoom } as CSSProperties}
      >
        {ordered
          .filter((n) => n.type === 'group')
          .map((n) => (
            <NodeView
              key={n.id}
              node={n}
              selected={sel.includes(n.id)}
              single={single === n.id}
              tools={tool === 'select'}
              editing={editing?.kind === 'node' && editing.id === n.id ? editing : null}
              onFinish={editing?.id === n.id ? finishEdit : noop}
            />
          ))}

        <svg aria-hidden className="pointer-events-none absolute top-0 left-0 size-px overflow-visible">
          <defs>
            {markers.map((key) => (
              <marker
                key={key}
                id={`b${boardId}-${key || 'none'}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0.5 L10 5 L0 9.5 z" fill={key === 'sel' ? 'var(--highlight)' : lineColor(key)} />
              </marker>
            ))}
          </defs>
          {data.edges.map((e) => {
            const a = byId.get(e.fromNode)
            const b = byId.get(e.toNode)
            if (!a || !b) return null
            const g = edgeGeometry(e, a, b)
            const picked = selEdge === e.id
            const key = picked ? 'sel' : (e.color ?? '')
            return (
              <g key={e.id} data-edge-id={e.id}>
                <path
                  d={g.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ pointerEvents: 'stroke' }}
                  className="cursor-pointer"
                />
                <path
                  d={g.d}
                  fill="none"
                  stroke={picked ? 'var(--highlight)' : lineColor(e.color)}
                  strokeWidth={picked ? 2.5 : 2}
                  markerEnd={e.toEnd === 'none' ? undefined : marker(key)}
                  markerStart={e.fromEnd === 'arrow' ? marker(key) : undefined}
                />
              </g>
            )
          })}
          {d?.kind === 'connect' &&
            (() => {
              const from = byId.get(d.from)
              if (!from) return null
              const target = nodeAt(data.nodes, d, d.from)
              const g = target ? edgePath(rect(from), rect(target)) : curve(sidePoint(rect(from), d.side), d.side, d, null)
              return <path d={g.d} fill="none" stroke="var(--highlight)" strokeWidth={2} strokeDasharray="6 5" markerEnd={marker('sel')} />
            })()}
        </svg>

        {ordered
          .filter((n) => n.type !== 'group')
          .map((n) => (
            <NodeView
              key={n.id}
              node={n}
              selected={sel.includes(n.id)}
              single={single === n.id}
              tools={tool === 'select'}
              editing={editing?.kind === 'node' && editing.id === n.id ? editing : null}
              onFinish={editing?.id === n.id ? finishEdit : noop}
            />
          ))}

        {/* подписи стрелок — над карточками, иначе у близких карточек их не видно */}
        <svg aria-hidden className="pointer-events-none absolute top-0 left-0 size-px overflow-visible">
          {data.edges.map((e) => {
            const a = byId.get(e.fromNode)
            const b = byId.get(e.toNode)
            if (!e.label || !a || !b || editedEdge?.id === e.id) return null
            const { mid } = edgeGeometry(e, a, b)
            return (
              <text
                key={e.id}
                data-edge-id={e.id}
                x={mid.x}
                y={mid.y}
                dy="0.35em"
                textAnchor="middle"
                style={{ pointerEvents: 'all', paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 5, strokeLinejoin: 'round' }}
                className="cursor-pointer fill-foreground text-[14px]"
              >
                {e.label}
              </text>
            )
          })}
        </svg>

        {editedEdge &&
          (() => {
            const a = byId.get(editedEdge.fromNode)
            const b = byId.get(editedEdge.toNode)
            if (!a || !b) return null
            const { mid } = edgeGeometry(editedEdge, a, b)
            return <EdgeLabelEditor key={editedEdge.id} at={mid} value={editedEdge.label ?? ''} onFinish={finishEdit} />
          })()}

        {(d?.kind === 'marquee' || d?.kind === 'draw') &&
          (() => {
            const r = rectOf(d.x0, d.y0, d.x1, d.y1)
            return (
              <div
                style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderWidth: 'calc(1.5px * var(--inv))' }}
                className={cn(
                  'pointer-events-none absolute rounded-[calc(6px*var(--inv))] border-highlight',
                  d.kind === 'marquee' ? 'border-solid bg-highlight/8' : 'border-dashed bg-highlight/5',
                )}
              />
            )
          })()}
      </div>

      {!data.nodes.length && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm text-[14px] text-muted-foreground">
            <p className="text-[17px] font-semibold text-foreground">Пустая доска</p>
            <p className="mt-2">
              Двойной щелчок — стикер. Внизу — карточки, рамки и картинки; картинку можно вставить Ctrl V или перетащить.
            </p>
            <p className="mt-2">Колесо — прокрутка, Ctrl и колесо — масштаб, пробел — двигать доску.</p>
          </div>
        </div>
      )}

      {!editing && !d && (sel.length > 0 || selectedEdge) && (
        <SelectionBar
          color={selectedEdge ? selectedEdge.color : selColors.size === 1 ? [...selColors][0] : undefined}
          edge={selectedEdge}
          onColor={setColor}
          onArrows={selectedEdge ? cycleArrows : undefined}
          onFront={selectedEdge ? undefined : toFront}
          onDuplicate={selectedEdge ? undefined : duplicate}
          onDelete={removeSelection}
        />
      )}

      <BoardToolbar
        tool={tool}
        onTool={(t) => {
          setTool(t)
          root.current?.focus({ preventScroll: true })
        }}
        onImage={() => fileInput.current?.click()}
        zoom={view.zoom}
        onZoom={zoomBy}
        onFit={fit}
        onUndo={undo}
        onRedo={redo}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void addImages(files, center())
        }}
      />
    </div>
  )
}

// карточки, которые сейчас не правят, получают одну и ту же функцию — memo не сбрасывается
const noop = () => {}
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const HANDLE_POS: Record<Side, string> = {
  top: 'left-1/2 top-0',
  right: 'left-full top-1/2',
  bottom: 'left-1/2 top-full',
  left: 'left-0 top-1/2',
}
const SELECTED: CSSProperties = { outline: 'calc(2px * var(--inv)) solid var(--highlight)', outlineOffset: 'calc(2px * var(--inv))' }

/** Картинка из хранилища: только картинки и только через адаптер (он же проверяет путь). */
function useVaultImage(path?: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path || !IMAGE.test(path)) return
    let alive = true
    vaultFileUrl(path).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl(null),
    )
    return () => {
      alive = false
    }
  }, [path])
  return path && IMAGE.test(path) ? url : null
}

const NodeView = memo(function NodeView({
  node: n,
  selected,
  single,
  tools,
  editing,
  onFinish,
}: {
  node: BoardNode
  selected: boolean
  single: boolean
  tools: boolean
  editing: Editing
  onFinish: (value: string, height?: number) => void
}) {
  const group = n.type === 'group'
  const sticky = n.type === 'text' && !!n.color
  return (
    <div
      data-node-id={n.id}
      style={{ left: n.x, top: n.y, width: n.width, height: n.height, ...nodeStyle(n), ...(selected ? SELECTED : {}) }}
      className={cn(
        'group/node absolute',
        group
          ? 'pointer-events-none rounded-[18px] border-2'
          : cn('rounded-[12px] border shadow-card', !n.color && 'border-border bg-card', n.type === 'file' && 'overflow-hidden bg-muted'),
      )}
    >
      {group ? (
        <div className="pointer-events-auto absolute bottom-full left-0 mb-[calc(6px*var(--inv))] max-w-full cursor-default">
          {editing ? (
            <InlineEditor value={n.label ?? ''} onFinish={onFinish} className="text-[16px] font-semibold" />
          ) : (
            // издалека подпись рамки не должна становиться нечитаемой
            <div
              className="truncate rounded-md px-1 font-semibold text-muted-foreground"
              style={{ fontSize: 'calc(16px * max(1, var(--inv) * 0.6))' }}
            >
              {n.label || 'Рамка'}
            </div>
          )}
        </div>
      ) : n.type === 'file' ? (
        <FileNode path={n.file} />
      ) : n.type === 'link' ? (
        editing ? (
          <TextEditor value={n.url ?? ''} onFinish={onFinish} />
        ) : (
          <LinkNode url={n.url} />
        )
      ) : editing ? (
        <TextEditor value={n.text ?? ''} centered={sticky} onFinish={onFinish} select={editing.fresh} />
      ) : (
        <div
          className={cn(
            'size-full overflow-hidden px-3.5 py-3 text-[15px] leading-[1.45] break-words',
            sticky && 'flex flex-col justify-center text-center',
          )}
        >
          <BoardText text={n.text ?? ''} />
        </div>
      )}

      {tools && !editing && (
        <div className={cn('pointer-events-none absolute inset-0 opacity-0 group-hover/node:opacity-100', selected && 'opacity-100')}>
          {SIDES.map((side) => (
            <span
              key={side}
              data-handle={side}
              role="button"
              aria-label="Протянуть стрелку"
              className={cn(
                'pointer-events-auto absolute size-[calc(12px*var(--inv))] -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-[calc(2px*var(--inv))] border-background bg-highlight shadow-card',
                HANDLE_POS[side],
              )}
            />
          ))}
        </div>
      )}
      {single && !editing && (
        <span
          data-resize=""
          role="button"
          aria-label="Изменить размер"
          className="pointer-events-auto absolute top-full left-full size-[calc(12px*var(--inv))] -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-[calc(3px*var(--inv))] border-[calc(2px*var(--inv))] border-background bg-highlight"
        />
      )}
    </div>
  )
})

function FileNode({ path }: { path?: string }) {
  const url = useVaultImage(path)
  if (url) return <img src={url} alt="" draggable={false} className="pointer-events-none size-full object-cover" />
  return (
    <div className="flex size-full items-center justify-center gap-2 p-3 text-[14px] text-muted-foreground">
      <FileText className="size-4 shrink-0" />
      <span className="truncate">{path ? basename(path) : 'Файл'}</span>
    </div>
  )
}

function LinkNode({ url }: { url?: string }) {
  // только http(s): javascript: и прочее из чужого файла в ссылку не превращаем
  const safe = url && /^https?:\/\//i.test(url) ? url : null
  return (
    <div className="flex size-full items-center gap-2 px-3.5 py-3 text-[14px]">
      <Link2 className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{url || 'Ссылка'}</span>
      {safe && (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Открыть ссылку"
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  )
}

/** Правка текста карточки: Esc или Ctrl Enter — готово; высота растёт под текст. */
function TextEditor({
  value,
  centered,
  select,
  onFinish,
}: {
  value: string
  centered?: boolean
  select?: boolean
  onFinish: (v: string, h?: number) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (select) el.select()
    else el.setSelectionRange(el.value.length, el.value.length)
  }, [select])
  const finish = () => {
    const el = ref.current
    if (!el || done.current) return
    done.current = true
    onFinish(el.value, el.scrollHeight)
  }
  return (
    <textarea
      ref={ref}
      data-editor=""
      defaultValue={value}
      aria-label="Текст карточки"
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          finish()
        }
      }}
      className={cn(
        'thin-scrollbar size-full resize-none bg-transparent px-3.5 py-3 text-[15px] leading-[1.45] outline-none select-text',
        centered && 'text-center',
      )}
    />
  )
}

function InlineEditor({ value, className, onFinish }: { value: string; className?: string; onFinish: (v: string) => void }) {
  const done = useRef(false)
  const finish = (v: string) => {
    if (done.current) return
    done.current = true
    onFinish(v)
  }
  return (
    <input
      data-editor=""
      autoFocus
      defaultValue={value}
      aria-label="Подпись"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          finish(e.currentTarget.value)
        }
      }}
      className={cn('w-64 rounded-md border border-highlight bg-background px-1.5 py-0.5 outline-none select-text', className)}
    />
  )
}

function EdgeLabelEditor({ at, value, onFinish }: { at: Pt; value: string; onFinish: (v: string) => void }) {
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: at.x, top: at.y }}>
      <InlineEditor value={value} onFinish={onFinish} className="w-48 text-center text-[14px]" />
    </div>
  )
}
