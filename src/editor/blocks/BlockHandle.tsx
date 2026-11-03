import type { Node as PMNode } from "@tiptap/pm/model"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import type { Editor } from "@tiptap/react"
import { GripVertical, Plus } from "lucide-react"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { foldingKey } from "./folding"
import { blockPos, foldedBlocks, moveTarget, sectionRange } from "./sections"

const ITEM_TYPES = new Set(["listItem", "taskItem"])

type Target = { kind: "block"; index: number; el: HTMLElement } | { kind: "item"; el: HTMLElement; pos: number }

interface Gap {
  y: number
  left: number
  right: number

  index?: number

  pos?: number
}

interface DragState {
  target: Target
  sx: number
  sy: number
  active: boolean
  ghost?: HTMLElement
  offsetY: number
  gaps: Gap[]
  gap?: Gap
  sources: HTMLElement[]

  dim?: HTMLStyleElement
}

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

function itemAtPos(doc: PMNode, pos: number) {
  const node = doc.nodeAt(pos)
  if (!node || !ITEM_TYPES.has(node.type.name)) return null
  const $p = doc.resolve(pos)
  return { from: pos, to: pos + node.nodeSize, node, list: $p.parent, listFrom: $p.before(), listTo: $p.after() }
}

function itemAt(editor: Editor, el: HTMLElement) {
  const inner = editor.view.posAtDOM(el.querySelector("p") ?? el, 0)
  if (inner < 0) return null
  const $p = editor.state.doc.resolve(inner)
  for (let d = $p.depth; d > 0; d--) {
    const node = $p.node(d)
    if (ITEM_TYPES.has(node.type.name))
      return { from: $p.before(d), to: $p.after(d), node, list: $p.node(d - 1), listFrom: $p.before(d - 1), listTo: $p.after(d - 1) }
  }
  return null
}

export function BlockHandle({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const self = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ target: Target; top: number; left: number } | null>(null)
  const [line, setLine] = useState<{ y: number; left: number; width: number } | null>(null)
  const drag = useRef<DragState | null>(null)

  const wrapper = () => self.current?.parentElement ?? null

  const targets = (): Target[] => {
    const out: Target[] = []
    ;[...editor.view.dom.children].forEach((child, index) => {
      const el = child as HTMLElement
      if (el.classList.contains("is-folded") || !el.offsetParent) return
      out.push({ kind: "block", index, el })
      if (/^(UL|OL)$/.test(el.tagName))
        for (const li of el.querySelectorAll<HTMLElement>(":scope > li")) out.push({ kind: "item", el: li, pos: 0 })
    })
    return out
  }

  const place = (t: Target) => {
    const w = wrapper()
    if (!w) return null
    const wr = w.getBoundingClientRect()
    const r = t.el.getBoundingClientRect()
    const cs = getComputedStyle(t.el)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
    const pad = parseFloat(cs.paddingTop) || 0
    return { top: r.top - wr.top + pad + (lh - 24) / 2, left: (t.kind === "item" ? r.left - wr.left - 22 : 0) - 76 }
  }

  useEffect(() => {
    if (disabled) {
      setHover(null)
      return
    }
    const area = wrapper()?.closest<HTMLElement>(".note-prose") ?? wrapper()
    if (!area) return
    const onMove = (e: MouseEvent) => {
      if (drag.current) return
      const y = e.clientY
      let best: Target | null = null
      for (const t of targets()) {
        const r = t.el.getBoundingClientRect()
        if (y >= r.top - 4 && y <= r.bottom + 4) {
          if (!best || t.kind === "item") best = t
        }
      }
      if (!best) return
      const p = place(best)
      if (p) setHover((h) => (h && h.target.el === best!.el && Math.abs(h.top - p.top) < 0.5 ? h : { target: best!, ...p }))
    }
    const onLeave = () => !drag.current && setHover(null)
    const onKey = () => !drag.current && setHover(null)
    area.addEventListener("mousemove", onMove)
    area.addEventListener("mouseleave", onLeave)
    editor.view.dom.addEventListener("keydown", onKey)
    return () => {
      area.removeEventListener("mousemove", onMove)
      area.removeEventListener("mouseleave", onLeave)
      editor.view.dom.removeEventListener("keydown", onKey)
    }
  }, [editor, disabled]) // oxlint-disable-line react-hooks/exhaustive-deps

  const sourcesOf = (t: Target): HTMLElement[] => {
    if (t.kind === "item") return [t.el]
    const [from, to] = sectionRange(editor.state.doc, t.index)
    return [...editor.view.dom.children].slice(from, to) as HTMLElement[]
  }

  const gapsFor = (t: Target): Gap[] => {
    const w = wrapper()!
    const wr = w.getBoundingClientRect()
    const doc = editor.state.doc
    const kids = [...editor.view.dom.children] as HTMLElement[]
    const { hidden } = foldedBlocks(doc, foldingKey.getState(editor.state) ?? new Set())
    const gaps: Gap[] = []
    const range = t.kind === "block" ? sectionRange(doc, t.index) : null
    for (let i = 0; i <= kids.length; i++) {
      if (hidden.has(i)) continue
      if (range && moveTarget(range[0], range[1], i) === null) continue
      const el = kids[i] ?? kids[kids.length - 1]
      if (!el) continue
      const r = el.getBoundingClientRect()
      gaps.push({ y: (i < kids.length ? r.top : r.bottom) - wr.top, left: 0, right: wr.width, index: i })
    }
    if (t.kind === "item") {
      const own = itemAt(editor, t.el)
      for (const list of kids) {
        if (!/^(UL|OL)$/.test(list.tagName) || list.classList.contains("is-folded")) continue
        const items = [...list.querySelectorAll<HTMLElement>(":scope > li")]
        items.forEach((li, k) => {
          const it = itemAt(editor, li)
          if (!it || !own || it.node.type !== own.node.type) return
          const r = li.getBoundingClientRect()
          const push = (y: number, pos: number) =>
            pos !== own.from && pos !== own.to && gaps.push({ y: y - wr.top, left: r.left - wr.left, right: wr.width, pos })
          push(r.top, it.from)
          if (k === items.length - 1) push(r.bottom, it.to)
        })
      }
    }
    return gaps
  }

  const onGripDown = (e: ReactPointerEvent) => {
    if (!hover || e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const t = hover.target
    if (t.kind === "item") t.pos = itemAt(editor, t.el)?.from ?? 0
    drag.current = { target: t, sx: e.clientX, sy: e.clientY, active: false, offsetY: 0, gaps: [], sources: [] }
  }

  const start = (d: DragState, e: ReactPointerEvent) => {
    d.active = true
    d.sources = sourcesOf(d.target)
    d.gaps = gapsFor(d.target)
    const first = d.sources[0].getBoundingClientRect()

    const prose = editor.view.dom.closest<HTMLElement>(".note-prose")
    const ghost = document.createElement("div")
    ghost.className = "note-prose block-ghost"
    if (prose?.dataset.font) ghost.dataset.font = prose.dataset.font
    ghost.style.width = `${editor.view.dom.clientWidth}px`
    ghost.style.left = `${editor.view.dom.getBoundingClientRect().left}px`
    const inner = document.createElement("div")
    inner.className = "tiptap"
    for (const s of d.sources) inner.append(s.cloneNode(true))
    inner.querySelectorAll(".fold-toggle").forEach((b) => b.remove())
    ghost.append(inner)
    document.body.append(ghost)
    d.ghost = ghost
    d.offsetY = e.clientY - first.top
    const kids = [...editor.view.dom.children]
    const sel = d.sources.map((s) => {
      const top = kids.indexOf(s)
      if (top >= 0) return `.tiptap > :nth-child(${top + 1})`
      const list = s.parentElement!
      return `.tiptap > :nth-child(${kids.indexOf(list) + 1}) > li:nth-child(${[...list.children].indexOf(s) + 1})`
    })
    d.dim = document.createElement("style")
    d.dim.textContent = `${sel.join(",")} { opacity: 0.3; transition: opacity 120ms; }`
    document.head.append(d.dim)
    document.body.classList.add("is-block-dragging")
  }

  const onGripMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.active) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
      start(d, e)
    }
    d.ghost!.style.top = `${e.clientY - d.offsetY}px`

    const scroller = editor.view.dom.closest<HTMLElement>("[data-scroll-root]") ?? document.scrollingElement
    if (scroller) {
      const edge = 70
      if (e.clientY < edge) scroller.scrollBy(0, -14)
      else if (e.clientY > innerHeight - edge) scroller.scrollBy(0, 14)
    }
    const w = wrapper()!.getBoundingClientRect()
    d.gaps = gapsFor(d.target)
    const y = e.clientY - w.top

    const dist = (g: Gap) => Math.abs(g.y - y) - (g.pos !== undefined ? 6 : 0)
    const gap = d.gaps.reduce<Gap | undefined>((best, g) => (!best || dist(g) < dist(best) ? g : best), undefined)
    d.gap = gap
    setLine(gap ? { y: gap.y, left: gap.left, width: gap.right - gap.left } : null)
  }

  const finish = () => {
    const d = drag.current
    drag.current = null
    setLine(null)
    document.body.classList.remove("is-block-dragging")
    if (!d) return
    d.dim?.remove()
    const ghostTop = d.ghost?.getBoundingClientRect().top
    d.ghost?.remove()
    if (!d.active) {
      const pos = d.target.kind === "block" ? blockPos(editor.state.doc, d.target.index) : d.target.pos
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
      editor.view.focus()
      return
    }
    if (!d.gap) return
    move(d.target, d.gap, ghostTop)
  }

  const move = (t: Target, gap: Gap, ghostTop?: number) => {
    const before = new Map<Element, number>()
    const watched = [...editor.view.dom.querySelectorAll(":scope > *, :scope > ul > li, :scope > ol > li")]
    for (const el of watched) before.set(el, el.getBoundingClientRect().top)

    const { state } = editor
    const doc = state.doc
    let tr = state.tr
    let insertedAt = -1
    if (t.kind === "block") {
      const [from, to] = sectionRange(doc, t.index)
      const a = blockPos(doc, from)
      const b = blockPos(doc, to)
      const slice = doc.slice(a, b)
      tr = tr.delete(a, b)
      insertedAt = tr.mapping.map(blockPos(doc, gap.index!))
      tr.insert(insertedAt, slice.content)
    } else {
      const it = itemAtPos(doc, t.pos)
      if (!it) return

      const [a, b] = it.list.childCount === 1 ? [it.listFrom, it.listTo] : [it.from, it.to]
      tr = tr.delete(a, b)
      if (gap.pos !== undefined) {
        insertedAt = tr.mapping.map(gap.pos)
        tr.insert(insertedAt, it.node)
      } else {
        insertedAt = tr.mapping.map(blockPos(doc, gap.index!))
        tr.insert(insertedAt, it.list.type.create(it.list.attrs, it.node as PMNode))
      }
    }
    try {
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertedAt + 1, tr.doc.content.size))))
    } catch {}
    editor.view.dispatch(tr)

    if (reduced()) return
    const anims: HTMLElement[] = []
    for (const el of editor.view.dom.querySelectorAll<HTMLElement>(":scope > *, :scope > ul > li, :scope > ol > li")) {
      const now = el.getBoundingClientRect().top
      const was = before.get(el)
      const dy = was !== undefined ? was - now : ghostTop !== undefined ? ghostTop - now : 0
      if (Math.abs(dy) < 1) continue
      el.style.transition = "none"
      el.style.transform = `translateY(${dy}px)`
      anims.push(el)
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const el of anims) {
          el.style.transition = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)"
          el.style.transform = ""
          el.addEventListener("transitionend", () => (el.style.transition = ""), { once: true })
        }
      }),
    )
  }

  const onPlus = () => {
    if (!hover) return
    const t = hover.target
    const { state } = editor
    if (t.kind === "item") {
      const it = itemAt(editor, t.el)
      if (!it) return
      const item = it.node.type.createAndFill()
      if (!item) return
      const tr = state.tr.insert(it.to, item)
      tr.setSelection(TextSelection.near(tr.doc.resolve(it.to + 2)))
      editor.view.dispatch(tr)
    } else {
      const node = state.doc.child(t.index)
      const collapsed = t.el.classList.contains("is-collapsed")
      const at = collapsed ? blockPos(state.doc, sectionRange(state.doc, t.index)[1]) : blockPos(state.doc, t.index) + node.nodeSize
      const tr = state.tr.insert(at, state.schema.nodes.paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, at + 1))
      editor.view.dispatch(tr)
    }
    editor.view.focus()
  }

  const btn =
    "flex size-6 items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <div ref={self} aria-hidden={!hover} className="pointer-events-none absolute top-0 left-0 z-[6] size-0">
      {hover && !disabled && (
        <div style={{ top: hover.top, left: hover.left }} className="pointer-events-auto absolute flex items-center gap-0.5 select-none">
          <button
            type="button"
            aria-label="Новая строка ниже"
            title="Новая строка ниже"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPlus}
            className={btn}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Перетащить блок"
            title="Перетащить блок"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={finish}
            onPointerCancel={finish}
            className={`${btn} cursor-grab touch-none active:cursor-grabbing`}
          >
            <GripVertical className="size-4" />
          </button>
        </div>
      )}
      {line && (
        <div
          style={{ top: line.y - 1.5, left: line.left, width: line.width }}
          className="absolute h-[3px] rounded-full bg-highlight/80 shadow-[0_0_0_2px_var(--background)]"
        />
      )}
    </div>
  )
}
