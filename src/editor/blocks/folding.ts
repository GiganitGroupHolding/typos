import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { blockPos, foldedBlocks, headingKey, headingLevel, sectionRange } from "./sections"

export const foldingKey = new PluginKey<Set<string>>("folding")

const storageKey = (id: string) => `typos-fold:${id}`

function readFolded(id: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey(id)) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

function writeFolded(id: string, set: Set<string>) {
  try {
    if (set.size) localStorage.setItem(storageKey(id), JSON.stringify([...set]))
    else localStorage.removeItem(storageKey(id))
  } catch {}
}

function toggleAt(state: EditorState, index: number): Transaction | null {
  const node = state.doc.maybeChild(index)
  if (!node || headingLevel(node) === null) return null
  const key = headingKey(node)
  const next = new Set(foldingKey.getState(state))
  const folding = !next.has(key)
  if (folding) next.add(key)
  else next.delete(key)
  const tr = state.tr.setMeta(foldingKey, next)

  if (folding) {
    const [, to] = sectionRange(state.doc, index)
    const start = blockPos(state.doc, index)
    const { from } = state.selection
    if (from > start + node.nodeSize && from < blockPos(state.doc, to))
      tr.setSelection(TextSelection.create(tr.doc, start + node.nodeSize - 1))
  }
  return tr
}

export interface FoldingOptions {
  noteId: string
}

export const Folding = Extension.create<FoldingOptions>({
  name: "folding",
  addOptions: () => ({ noteId: "" }),

  addCommands() {
    return {
      toggleFold:
        (index: number) =>
        ({ state, dispatch }) => {
          const tr = toggleAt(state, index)
          if (!tr) return false
          dispatch?.(tr)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const id = this.options.noteId
    return [
      new Plugin<Set<string>>({
        key: foldingKey,
        state: {
          init: () => readFolded(id),
          apply(tr, value) {
            const next = tr.getMeta(foldingKey) as Set<string> | undefined
            if (!next) return value
            writeFolded(id, next)
            return next
          },
        },
        props: {
          decorations(state) {
            const collapsed = foldingKey.getState(state) ?? new Set<string>()
            const { headings, hidden } = foldedBlocks(state.doc, collapsed)
            const decos: Decoration[] = []
            state.doc.forEach((node, offset, index) => {
              if (hidden.has(index)) {
                decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "is-folded" }))
                return
              }
              if (headingLevel(node) === null) return
              const [from, to] = sectionRange(state.doc, index)
              if (to - from < 2) return
              const folded = headings.includes(index)
              decos.push(Decoration.node(offset, offset + node.nodeSize, { class: folded ? "has-fold is-collapsed" : "has-fold" }))
              decos.push(
                Decoration.widget(
                  offset + 1,
                  (view) => {
                    const b = document.createElement("button")
                    b.type = "button"
                    b.className = "fold-toggle"
                    b.contentEditable = "false"
                    b.setAttribute("aria-label", folded ? "Развернуть раздел" : "Свернуть раздел")
                    b.setAttribute("aria-expanded", String(!folded))
                    b.innerHTML =
                      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                    b.addEventListener("mousedown", (e) => {
                      e.preventDefault()
                      e.stopPropagation()

                      let at = -1
                      view.state.doc.forEach((_n, off, i) => {
                        if (off === offset) at = i
                      })
                      const tr = at >= 0 ? toggleAt(view.state, at) : null
                      if (tr) view.dispatch(tr)
                    })
                    return b
                  },
                  { side: -1, ignoreSelection: true, key: `fold-${index}-${folded ? 1 : 0}` },
                ),
              )
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    folding: {
      toggleFold: (index: number) => ReturnType
    }
  }
}
