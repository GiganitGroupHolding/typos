import type { Editor } from "@tiptap/react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useUi } from "@/app/store"
import { useLiquidLens } from "@/components/ui/LiquidLens"
import { cn } from "@/lib/utils"
import { useVault } from "@/vault/store"
import { clamp, contains, curve, edgePath, rectOf, sidePoint, type Rect, type Side } from "./geometry"
import { blockSize, layoutFlow, parseFlowchart, type LaidOut } from "./mermaidToMap"
import { mapSlots } from "./slots"
import { blockKey, codeHash, mapId, MIN_H, MIN_W, resolveBlock, type MapGroup, type MapNode, type NoteMap } from "./types"

const SIDES: Side[] = ["top", "right", "bottom", "left"]
const NEW_W = 150
const NEW_H = 44
const SLOT_PAD = 16

type Drag =
  | { kind: "draw"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "move"; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean }
  | { kind: "resize"; id: string; sx: number; sy: number; w: number; h: number }
  | { kind: "connect"; from: string; side: Side; x: number; y: number }

type Selection = { kind: "node" | "edge"; id: string } | null

function mermaidBlocks(editor: Editor) {
  const out: { hash: string; code: string }[] = []
  editor.state.doc.forEach((n) => {
    if (n.type.name === "codeBlock" && n.attrs.language === "mermaid") out.push({ hash: codeHash(n.textContent), code: n.textContent })
  })
  return out
}

function textMeasure(el: HTMLElement) {
  const ctx = document.createElement("canvas").getContext("2d")
  const font = `500 15px ${getComputedStyle(el).fontFamily}`
  return (text: string) =>
    blockSize(text, (line) => {
      if (!ctx) return line.length * 8.2
      ctx.font = font
      return ctx.measureText(line).width
    })
}

function withFlow(map: NoteMap, hash: string, laid: LaidOut, width: number): NoteMap {
  const group: MapGroup = { id: mapId("g"), anchor: { kind: "mermaid", hash } }
  const dx = Math.max(0, Math.round((width - laid.width) / 2))
  const ids = new Map(laid.nodes.map((n) => [n.id, mapId("n")]))
  return {
    ...map,
    groups: [...map.groups, group],
    nodes: [
      ...map.nodes,
      ...laid.nodes.map((n) => ({ id: ids.get(n.id)!, group: group.id, x: n.x + dx, y: n.y + SLOT_PAD / 2, w: n.w, h: n.h, text: n.text })),
    ],
    edges: [...map.edges, ...laid.edges.map((e) => ({ id: mapId("e"), from: ids.get(e.from)!, to: ids.get(e.to)!, label: e.label }))],
  }
}

function withoutGroup(map: NoteMap, groupId: string): NoteMap {
  const gone = new Set(map.nodes.filter((n) => n.group === groupId).map((n) => n.id))
  return {
    ...map,
    groups: map.groups.filter((g) => g.id !== groupId),
    nodes: map.nodes.filter((n) => !gone.has(n.id)),
    edges: map.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  }
}

function markEdited(map: NoteMap, nodeIds: string[]): NoteMap {
  const groups = new Set(map.nodes.filter((n) => nodeIds.includes(n.id)).map((n) => n.group))
  if (!map.groups.some((g) => groups.has(g.id) && g.anchor.kind === "mermaid" && !g.edited)) return map
  return { ...map, groups: map.groups.map((g) => (groups.has(g.id) && g.anchor.kind === "mermaid" ? { ...g, edited: true } : g)) }
}

export function NoteCanvas({ editor, noteId, readOnly }: { editor: Editor; noteId: string; readOnly?: boolean }) {
  const layer = useRef<HTMLDivElement>(null)
  const [map, setMapState] = useState<NoteMap | null>(null)
  const mapRef = useRef<NoteMap | null>(null)
  const history = useRef<NoteMap[]>([])
  const saveTimer = useRef(0)
  const [tops, setTops] = useState<Record<string, number>>({})
  const topsRef = useRef(tops)
  const [width, setWidth] = useState(0)
  const [sig, setSig] = useState(() =>
    mermaidBlocks(editor)
      .map((b) => b.hash)
      .join(","),
  )
  const [sel, setSel] = useState<Selection>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const storeMode = useUi((s) => s.mapMode)
  const setMapMode = useUi((s) => s.setMapMode)
  const mode = storeMode && !readOnly

  const setDrag = (d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }

  const save = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = 0
    const m = mapRef.current
    if (!m) return

    const t = topsRef.current
    const next = { ...m, groups: m.groups.map((g) => (t[g.id] !== undefined ? { ...g, lastY: Math.round(t[g.id]) } : g)) }
    void useVault
      .getState()
      .saveNoteMap(noteId, next)
      .catch((e) => console.warn("Карта не сохранилась", e))
  }, [noteId])

  const commit = useCallback(
    (next: NoteMap, record = true) => {
      if (record && mapRef.current) history.current = [...history.current.slice(-49), mapRef.current]
      mapRef.current = next
      setMapState(next)
      clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(save, 400)
    },
    [save],
  )

  useEffect(() => {
    let alive = true
    void useVault
      .getState()
      .loadNoteMap(noteId)
      .then((m) => {
        if (!alive) return
        mapRef.current = m
        setMapState(m)
      })
    return () => {
      alive = false
      if (saveTimer.current) save()
      mapSlots.clear()
    }
  }, [noteId, save])

  const blocks = useCallback(() => [...editor.view.dom.children] as HTMLElement[], [editor])

  const contentBlocks = useCallback(
    () =>
      blocks().filter(
        (b) =>
          blockKey(b.textContent ?? "") !== "" ||
          !!b.querySelector('img, hr, table, .diagram-block, [data-type="block-math"]') ||
          b.matches(".diagram-block, hr"),
      ),
    [blocks],
  )

  const measure = useCallback(() => {
    const el = layer.current
    const m = mapRef.current
    if (!el || !m) return
    const base = el.getBoundingClientRect().top
    const all = blocks()
    const list = contentBlocks()
    const keys = list.map((b) => blockKey(b.textContent ?? ""))
    const topOf = (b: HTMLElement) => b.getBoundingClientRect().top - base
    const next: Record<string, number> = {}

    const fixed = new Map<string, { anchor: MapGroup["anchor"]; shift: number }>()
    for (const g of m.groups) {
      if (g.anchor.kind === "mermaid") {
        const d = editor.view.dom.querySelector<HTMLElement>(`.diagram-block[data-map-hash="${g.anchor.hash}"]`)

        if (d && !d.classList.contains("is-folded")) next[g.id] = topOf(d)
      } else if (g.anchor.kind === "block") {
        if (!g.anchor.text) {
          const old = all[Math.min(Math.max(g.anchor.index, 0), all.length - 1)]
          if (!old) continue
          const oldTop = topOf(old)
          let i = list.findLastIndex((b) => topOf(b) <= oldTop + 0.5)
          if (i < 0) i = 0
          if (!list[i]) continue
          next[g.id] = topOf(list[i])
          fixed.set(g.id, { anchor: { kind: "block", text: keys[i], index: i }, shift: oldTop - next[g.id] })
          continue
        }
        let i = resolveBlock(keys, g.anchor)
        if (i < 0 || list[i].classList.contains("is-folded")) continue
        let top = topOf(list[i])
        let shift = 0

        const own = m.nodes.filter((n) => n.group === g.id)
        if (own.length) {
          const upper = top + Math.min(...own.map((n) => n.y))
          if (top > upper + 0.5) {
            const j = Math.max(
              0,
              list.findLastIndex((b) => !b.classList.contains("is-folded") && topOf(b) <= upper + 0.5),
            )
            if (j !== i) {
              shift = top - topOf(list[j])
              i = j
              top = topOf(list[j])
            }
          }
        }
        next[g.id] = top
        if (shift || keys[i] !== g.anchor.text || i !== g.anchor.index)
          fixed.set(g.id, { anchor: { kind: "block", text: keys[i], index: i }, shift })
      } else next[g.id] = g.anchor.y
    }
    if (fixed.size) {
      commit(
        {
          ...m,
          groups: m.groups.map((g) => (fixed.has(g.id) ? { ...g, anchor: fixed.get(g.id)!.anchor } : g)),
          nodes: m.nodes.map((n) => (fixed.get(n.group)?.shift ? { ...n, y: Math.round(n.y + fixed.get(n.group)!.shift) } : n)),
        },
        false,
      )
    }
    setWidth(el.clientWidth)
    setTops((prev) => {
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([k, v]) => Math.abs((prev[k] ?? NaN) - v) < 0.5)
      if (same) return prev
      topsRef.current = next
      return next
    })
  }, [blocks, contentBlocks, editor, commit])

  useEffect(() => {
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return
      setSig(
        mermaidBlocks(editor)
          .map((b) => b.hash)
          .join(","),
      )
      schedule()
    }
    editor.on("transaction", onUpdate)
    const ro = new ResizeObserver(schedule)
    ro.observe(editor.view.dom)
    if (layer.current) ro.observe(layer.current)
    const off = mapSlots.subscribe(schedule)
    void document.fonts?.ready.then(schedule)
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      editor.off("transaction", onUpdate)
      ro.disconnect()
      off()
    }
  }, [editor, measure])

  useLayoutEffect(() => {
    if (map) measure()
  }, [map, measure])

  useEffect(() => {
    if (!map) return
    let cancelled = false
    const run = async () => {
      const el = layer.current
      let m = mapRef.current
      if (!el || !m) return
      const present = mermaidBlocks(editor)
      const hashes = new Set(present.map((b) => b.hash))
      let changed = false
      for (const g of m.groups) {
        if (g.anchor.kind !== "mermaid" || hashes.has(g.anchor.hash)) continue

        m = g.edited
          ? {
              ...m,
              groups: m.groups.map((x) =>
                x.id === g.id ? { ...x, anchor: { kind: "abs", y: topsRef.current[g.id] ?? g.lastY ?? 0 } } : x,
              ),
            }
          : withoutGroup(m, g.id)
        changed = true
      }
      for (const b of present) {
        if (m.groups.some((g) => g.anchor.kind === "mermaid" && g.anchor.hash === b.hash)) continue
        const flow = parseFlowchart(b.code)
        if (!flow) continue
        const sizes = textMeasure(editor.view.dom)
        let laid = await layoutFlow(flow, sizes)

        if (laid.width > el.clientWidth && (flow.dir === "LR" || flow.dir === "RL")) {
          const tall = await layoutFlow({ ...flow, dir: "TB" }, sizes)
          if (tall.width < laid.width) laid = tall
        }
        if (laid.width > el.clientWidth) {
          const k = el.clientWidth / laid.width
          laid = {
            ...laid,
            width: el.clientWidth,
            nodes: laid.nodes.map((n) => ({ ...n, x: Math.round(n.x * k), w: Math.max(MIN_W, Math.round(n.w * k)) })),
          }
        }
        if (cancelled) return
        m = withFlow(m, b.hash, laid, el.clientWidth)
        changed = true
      }
      if (changed) commit(m, false)
    }
    const t = window.setTimeout(() => void run(), 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [map === null, sig, editor, commit]) // oxlint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!map) return
    const next = new Map<string, number>()
    for (const g of map.groups) {
      if (g.anchor.kind !== "mermaid") continue
      const own = map.nodes.filter((n) => n.group === g.id)
      if (own.length) next.set(g.anchor.hash, Math.max(...own.map((n) => n.y + n.h)) + SLOT_PAD)
    }
    mapSlots.set(next)
  }, [map])

  const rects = useMemo(() => {
    const out = new Map<string, Rect & { node: MapNode }>()
    for (const n of map?.nodes ?? []) {
      const top = tops[n.group]
      if (top !== undefined) out.set(n.id, { x: n.x, y: top + n.y, w: n.w, h: n.h, node: n })
    }
    return out
  }, [map, tops])

  const point = (e: { clientX: number; clientY: number }) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const nodeAt = (p: { x: number; y: number }, except?: string) =>
    [...rects.values()].reverse().find((r) => r.node.id !== except && contains(r, p, 6))

  const groupAt = (m: NoteMap, y: number): { map: NoteMap; group: string; top: number } => {
    const base = layer.current!.getBoundingClientRect().top
    const list = contentBlocks()
    let i = list.findLastIndex((b) => !b.classList.contains("is-folded") && b.getBoundingClientRect().top - base <= y)
    if (i < 0) i = list.length ? 0 : -1
    if (i < 0) {
      const existing = m.groups.find((g) => g.anchor.kind === "abs" && g.anchor.y === 0)
      if (existing) return { map: m, group: existing.id, top: 0 }
      const g: MapGroup = { id: mapId("g"), anchor: { kind: "abs", y: 0 } }
      return { map: { ...m, groups: [...m.groups, g] }, group: g.id, top: 0 }
    }
    const el = list[i]
    const top = el.getBoundingClientRect().top - base
    const keys = list.map((b) => blockKey(b.textContent ?? ""))
    const same = m.groups.find((g) => g.anchor.kind === "block" && resolveBlock(keys, g.anchor) === i)
    if (same) return { map: m, group: same.id, top }

    const hash = el.dataset.mapHash
    const mermaid = hash && m.groups.find((g) => g.anchor.kind === "mermaid" && g.anchor.hash === hash)
    if (mermaid) return { map: m, group: mermaid.id, top }
    const g: MapGroup = { id: mapId("g"), anchor: { kind: "block", text: keys[i], index: i } }
    return { map: { ...m, groups: [...m.groups, g] }, group: g.id, top }
  }

  const addNode = (m: NoteMap, r: Rect): { map: NoteMap; id: string } => {
    const at = groupAt(m, r.y)
    const w = Math.max(MIN_W, r.w)
    const node: MapNode = {
      id: mapId("n"),
      group: at.group,
      x: clamp(r.x, 0, width - w),
      y: Math.max(0, r.y) - at.top,
      w,
      h: Math.max(MIN_H, r.h),
      text: "",
    }
    return { map: { ...at.map, nodes: [...at.map.nodes, node] }, id: node.id }
  }

  const removeSelection = () => {
    const m = mapRef.current
    if (!m || !sel) return
    if (sel.kind === "edge") commit({ ...m, edges: m.edges.filter((e) => e.id !== sel.id) })
    else {
      const marked = markEdited(m, [sel.id])
      commit({
        ...marked,
        nodes: marked.nodes.filter((n) => n.id !== sel.id),
        edges: marked.edges.filter((e) => e.from !== sel.id && e.to !== sel.id),
      })
    }
    setSel(null)
  }

  const undo = () => {
    const prev = history.current.pop()
    if (!prev) return
    commit(prev, false)
    setSel(null)
    setEditing(null)
  }

  const capture = (e: ReactPointerEvent) => layer.current?.setPointerCapture(e.pointerId)

  const onLayerDown = (e: ReactPointerEvent) => {
    if (!mode || e.button !== 0) return
    e.preventDefault()
    setEditing(null)
    const p = point(e)
    capture(e)
    setDrag({ kind: "draw", x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }

  const onNodeDown = (e: ReactPointerEvent, n: MapNode) => {
    if (!mode || e.button !== 0 || editing === n.id) return
    e.stopPropagation()
    e.preventDefault()
    setSel({ kind: "node", id: n.id })
    const p = point(e)
    capture(e)
    setDrag({ kind: "move", id: n.id, sx: p.x, sy: p.y, nx: n.x, ny: n.y, moved: false })
  }

  const onHandleDown = (e: ReactPointerEvent, n: MapNode, side: Side) => {
    e.stopPropagation()
    e.preventDefault()
    const p = point(e)
    capture(e)
    setDrag({ kind: "connect", from: n.id, side, x: p.x, y: p.y })
  }

  const onResizeDown = (e: ReactPointerEvent, n: MapNode) => {
    e.stopPropagation()
    e.preventDefault()
    const p = point(e)
    capture(e)
    history.current = [...history.current.slice(-49), mapRef.current!]
    setDrag({ kind: "resize", id: n.id, sx: p.x, sy: p.y, w: n.w, h: n.h })
  }

  const patchNode = (id: string, patch: Partial<MapNode>, record = false) => {
    const m = mapRef.current
    if (!m) return
    commit(markEdited({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }, [id]), record)
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const p = point(e)
    if (d.kind === "draw") setDrag({ ...d, x1: p.x, y1: p.y })
    else if (d.kind === "connect") setDrag({ ...d, x: p.x, y: p.y })
    else if (d.kind === "move") {
      if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < 3) return
      if (!d.moved) {
        history.current = [...history.current.slice(-49), mapRef.current!]
        dragRef.current = { ...d, moved: true }
      }
      const n = mapRef.current?.nodes.find((x) => x.id === d.id)
      if (!n) return
      const top = topsRef.current[n.group] ?? 0
      patchNode(d.id, { x: Math.round(clamp(d.nx + p.x - d.sx, 0, width - n.w)), y: Math.round(Math.max(-top, d.ny + p.y - d.sy)) })
    } else if (d.kind === "resize") {
      const n = mapRef.current?.nodes.find((x) => x.id === d.id)
      if (!n) return
      patchNode(d.id, { w: Math.round(clamp(d.w + p.x - d.sx, MIN_W, width - n.x)), h: Math.round(Math.max(MIN_H, d.h + p.y - d.sy)) })
    }
  }

  const onUp = (e: ReactPointerEvent) => {
    const d = dragRef.current
    setDrag(null)
    const m = mapRef.current
    if (!d || !m) return
    const p = point(e)
    if (d.kind === "draw") {
      const r = rectOf(d.x0, d.y0, d.x1, d.y1)
      if (r.w < MIN_W || r.h < MIN_H) return setSel(null)
      const made = addNode(m, r)
      commit(made.map)
      setSel({ kind: "node", id: made.id })
      setFresh(made.id)
      setEditing(made.id)
    } else if (d.kind === "connect") {
      const target = nodeAt(p, d.from)
      if (target) {
        if (m.edges.some((x) => (x.from === d.from && x.to === target.node.id) || (x.to === d.from && x.from === target.node.id))) return
        commit(markEdited({ ...m, edges: [...m.edges, { id: mapId("e"), from: d.from, to: target.node.id }] }, [d.from, target.node.id]))
        return
      }
      const from = rects.get(d.from)
      if (!from || Math.hypot(p.x - sidePoint(from, d.side).x, p.y - sidePoint(from, d.side).y) < 24) return

      const made = addNode(m, { x: p.x - NEW_W / 2, y: p.y - NEW_H / 2, w: NEW_W, h: NEW_H })
      commit(markEdited({ ...made.map, edges: [...made.map.edges, { id: mapId("e"), from: d.from, to: made.id }] }, [d.from]))
      setSel({ kind: "node", id: made.id })
      setFresh(made.id)
      setEditing(made.id)
    }
  }

  useEffect(() => {
    if (!mode) return
    const onKey = (e: KeyboardEvent) => {
      if (editing) return
      const m = mapRef.current
      const stop = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === "Escape") {
        stop()
        if (sel) setSel(null)
        else setMapMode(false)
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        stop()
        removeSelection()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        stop()
        undo()
      } else if (e.key === "Enter" && sel?.kind === "node") {
        stop()
        setEditing(sel.id)
      } else if (sel?.kind === "node" && m && e.key.startsWith("Arrow")) {
        stop()
        const step = e.shiftKey ? 20 : 4
        const n = m.nodes.find((x) => x.id === sel.id)
        if (!n) return
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
        patchNode(n.id, { x: clamp(n.x + dx, 0, width - n.w), y: n.y + dy }, true)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  useEffect(() => {
    if (!mode) {
      setSel(null)
      setEditing(null)
    }
  }, [mode])

  const commitText = (n: MapNode, text: string, height: number) => {
    setEditing(null)
    const m = mapRef.current
    if (!m) return
    const t = text.replace(/\n{3,}/g, "\n\n").trim()
    if (!t && fresh === n.id) {
      commit({ ...m, nodes: m.nodes.filter((x) => x.id !== n.id), edges: m.edges.filter((e) => e.from !== n.id && e.to !== n.id) }, false)
      setSel(null)
    } else if (t !== n.text || height > n.h) patchNode(n.id, { text: t, h: Math.max(n.h, Math.ceil(height)) }, fresh !== n.id)
    setFresh(null)
  }

  if (!map) return null
  const d = drag

  return (
    <>
      <div
        ref={layer}
        data-map-layer=""
        onPointerDown={onLayerDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        className={cn("absolute inset-0 z-[5] select-none", mode ? "pointer-events-auto cursor-crosshair" : "pointer-events-none")}
      >
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground">
          <defs>
            <marker
              id={`map-arrow-${noteId}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0.5 L10 5 L0 9.5 z" fill="currentColor" />
            </marker>
          </defs>
          {map.edges.map((e) => {
            const a = rects.get(e.from)
            const b = rects.get(e.to)
            if (!a || !b) return null
            const g = edgePath(a, b)
            const picked = sel?.kind === "edge" && sel.id === e.id
            return (
              <g key={e.id} className={picked ? "text-highlight" : undefined}>
                {mode && (
                  <path
                    d={g.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    className="pointer-events-auto cursor-pointer"
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      setSel({ kind: "edge", id: e.id })
                    }}
                  />
                )}
                <path d={g.d} fill="none" stroke="currentColor" strokeWidth={picked ? 2 : 1.5} markerEnd={`url(#map-arrow-${noteId})`} />
                {e.label && (
                  <text
                    x={g.mid.x}
                    y={g.mid.y}
                    dy="0.35em"
                    textAnchor="middle"
                    className="fill-foreground text-[12.5px]"
                    style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 4, strokeLinejoin: "round" }}
                  >
                    {e.label}
                  </text>
                )}
              </g>
            )
          })}
          {d?.kind === "connect" &&
            (() => {
              const from = rects.get(d.from)
              if (!from) return null
              const target = nodeAt(d, d.from)
              const g = target ? edgePath(from, target) : curve(sidePoint(from, d.side), d.side, d, null)
              return (
                <path
                  d={g.d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  markerEnd={`url(#map-arrow-${noteId})`}
                  className="text-highlight"
                />
              )
            })()}
        </svg>

        {[...rects.values()].map((r) => (
          <MapBlock
            key={r.node.id}
            node={r.node}
            rect={r}
            mode={mode}
            selected={sel?.kind === "node" && sel.id === r.node.id}
            editing={editing === r.node.id}
            onPointerDown={(e) => onNodeDown(e, r.node)}
            onDoubleClick={() => mode && setEditing(r.node.id)}
            onHandleDown={(e, side) => onHandleDown(e, r.node, side)}
            onResizeDown={(e) => onResizeDown(e, r.node)}
            onCommit={(text, h) => commitText(r.node, text, h)}
          />
        ))}

        {d?.kind === "draw" && (
          <div
            style={rectStyle(rectOf(d.x0, d.y0, d.x1, d.y1))}
            className={cn(
              "pointer-events-none absolute rounded-[14px] border-[1.5px] border-dashed",
              rectOf(d.x0, d.y0, d.x1, d.y1).w >= MIN_W && rectOf(d.x0, d.y0, d.x1, d.y1).h >= MIN_H
                ? "border-highlight bg-highlight/5"
                : "border-muted-foreground/50",
            )}
          />
        )}
      </div>
      {mode && <MapHint />}
    </>
  )
}

const rectStyle = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h })

function MapBlock({
  node,
  rect,
  mode,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onHandleDown,
  onResizeDown,
  onCommit,
}: {
  node: MapNode
  rect: Rect
  mode: boolean
  selected: boolean
  editing: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onDoubleClick: () => void
  onHandleDown: (e: ReactPointerEvent, side: Side) => void
  onResizeDown: (e: ReactPointerEvent) => void
  onCommit: (text: string, height: number) => void
}) {
  const lens = useLiquidLens({ bezel: 14, refraction: 16, dispersion: 0.09, frost: 1, fallback: "liquid liquid-lava" })
  return (
    <div
      ref={lens.attach}
      data-map-node={node.id}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{ ...lens.style, ...rectStyle(rect), position: "absolute" }}
      className={cn(
        lens.className,
        "group/node rounded-[14px] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-(--dur-fast)",
        mode ? "pointer-events-auto cursor-grab active:cursor-grabbing" : "pointer-events-none",
        selected && "outline-highlight",
      )}
    >
      {lens.extras}
      <NodeText text={node.text} editing={editing} onCommit={onCommit} />
      {mode && !editing && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 3 }}
          className={cn("pointer-events-none opacity-0 transition-opacity group-hover/node:opacity-100", selected && "opacity-100")}
        >
          {SIDES.map((side) => {
            const p = sidePoint({ x: 0, y: 0, w: rect.w, h: rect.h }, side)
            return (
              <span
                key={side}
                role="button"
                aria-label="Протянуть стрелку"
                onPointerDown={(e) => onHandleDown(e, side)}
                style={{ left: p.x, top: p.y }}
                className="pointer-events-auto absolute -mt-[7px] -ml-[7px] size-[14px] cursor-crosshair rounded-full border-2 border-background bg-highlight shadow-card transition-transform hover:scale-125"
              />
            )
          })}
          {selected && (
            <span
              role="button"
              aria-label="Изменить размер"
              onPointerDown={onResizeDown}
              className="pointer-events-auto absolute -right-1 -bottom-1 size-3 cursor-nwse-resize rounded-[4px] border-2 border-background bg-highlight"
            />
          )}
        </div>
      )}
    </div>
  )
}

function NodeText({ text, editing, onCommit }: { text: string; editing: boolean; onCommit: (text: string, height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!editing || !el) return
    done.current = false
    el.textContent = text
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
  }, [editing]) // oxlint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    const el = ref.current
    if (!el || done.current) return
    done.current = true
    onCommit(el.innerText, el.offsetHeight + 20)
  }

  const cls = "max-w-full text-center text-[15px] leading-5 font-medium break-words whitespace-pre-wrap"
  return (
    <div className="flex size-full items-center justify-center overflow-hidden px-3 py-2.5">
      {editing ? (
        <div
          ref={ref}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          role="textbox"
          aria-label="Текст блока"
          aria-multiline
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={finish}
          onKeyDown={(e) => {
            e.stopPropagation()
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
              e.preventDefault()
              finish()
            }
          }}
          className={cn(cls, "min-w-[2ch] cursor-text outline-none select-text")}
        />
      ) : (
        <div className={cls}>{text}</div>
      )}
    </div>
  )
}

function MapHint() {
  const lens = useLiquidLens({ bezel: 12, refraction: 12, dispersion: 0.09, frost: 1, fallback: "liquid liquid-lava" })
  return (
    <div
      ref={lens.attach}
      role="status"
      style={lens.style}
      className={cn(
        lens.className,
        "pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-[12.5px] whitespace-nowrap text-muted-foreground",
      )}
    >
      {lens.extras}
      <span>Потяни по фону, чтобы добавить блок. Esc для выхода.</span>
    </div>
  )
}
