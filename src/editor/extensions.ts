import { Extension, InputRule } from "@tiptap/core"
import Image from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics"
import { TableKit } from "@tiptap/extension-table"
import { Markdown } from "@tiptap/markdown"
import type { Node as PMNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import StarterKit from "@tiptap/starter-kit"
import { ColorHighlight, LastColor, TextColor } from "./colors"
import { DiagramCodeBlock } from "./diagrams"

export const katexOptions = { throwOnError: false, strict: "ignore" as const }

export const DollarMath = Extension.create<{ onBlockCreated?: (pos: number) => void }>({
  name: "dollarMath",
  addOptions() {
    return { onBlockCreated: undefined }
  },
  addInputRules() {
    const onBlockCreated = this.options.onBlockCreated
    const block = this.editor.schema.nodes.blockMath
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.textContent.trim() !== "$$") return null
          const pos = $from.before()
          chain()
            .deleteRange({ from: pos, to: $from.after() })
            .insertContentAt(pos, { type: block.name, attrs: { latex: "" } })
            .run()

          if (onBlockCreated) setTimeout(() => onBlockCreated(pos))
        },
      }),
    ]
  },
  addProseMirrorPlugins() {
    const inline = this.editor.schema.nodes.inlineMath
    const block = this.editor.schema.nodes.blockMath

    return [
      new Plugin({
        key: new PluginKey("dollarMathConvert"),
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null
          const ops: { from: number; to: number; node: PMNode }[] = []
          state.doc.descendants((node, pos, parent) => {
            if (node.type.name === "paragraph" && parent?.canReplaceWith(0, 0, block)) {
              const m = node.textContent.match(BLOCK_TEXT)
              if (m && node.childCount === 1 && node.firstChild?.isText) {
                ops.push({ from: pos, to: pos + node.nodeSize, node: block.create({ latex: (m[1] ?? m[2]).trim() }) })
                return false
              }
            }
            if (!node.isText || !parent || parent.type.spec.code) return
            if (!parent.canReplaceWith(0, 0, inline)) return
            if (node.marks.some((m) => m.type.spec.code)) return
            for (const m of node.text!.matchAll(INLINE_DOLLAR)) {
              const start = pos + m.index! + m[1].length
              ops.push({ from: start, to: start + m[0].length - m[1].length, node: inline.create({ latex: m[2] }) })
            }
            for (const m of node.text!.matchAll(INLINE_PAREN)) {
              ops.push({ from: pos + m.index!, to: pos + m.index! + m[0].length, node: inline.create({ latex: m[1].trim() }) })
            }
          })
          if (!ops.length) return null
          const tr = state.tr
          for (const op of ops.sort((a, b) => b.from - a.from)) tr.replaceWith(op.from, op.to, op.node)
          return tr
        },
      }),
    ]
  },
})

const INLINE_DOLLAR = /(^|[^$\\])\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?!\$)/g

const INLINE_PAREN = /\\\(\s*([^\n]+?)\s*\\\)/g

const BLOCK_TEXT = /^\s*(?:\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$)\s*$/

export interface ExtensionOptions {
  onMathClick?: (node: PMNode, pos: number, kind: "inline" | "block") => void
  onBlockMathCreated?: (pos: number) => void

  resolveImage?: (src: string) => Promise<string | null>

  diagrams?: boolean
}

const VaultImage = Image.extend<{ resolve?: ExtensionOptions["resolveImage"] } & Record<string, unknown>>({
  addOptions() {
    return { ...this.parent?.(), resolve: undefined }
  },
  addNodeView() {
    const resolve = this.options.resolve
    return ({ node }) => {
      const img = document.createElement("img")
      img.alt = node.attrs.alt ?? ""
      img.draggable = true
      const src: string = node.attrs.src ?? ""
      if (resolve && src && !/^(https?:|data:|blob:)/.test(src)) {
        img.dataset.loading = "true"
        void resolve(src).then((url) => {
          if (url) img.src = url
          else img.alt = `Нет файла: ${src}`
          delete img.dataset.loading
        })
      } else {
        img.src = src
      }
      return { dom: img }
    }
  },
})

export function buildExtensions({ onMathClick, onBlockMathCreated, resolveImage, diagrams = false }: ExtensionOptions = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
      codeBlock: false,
    }),
    DiagramCodeBlock.configure({ diagrams }),
    TaskList,
    TaskItem.configure({ nested: true }),

    TableKit.configure({ table: { renderWrapper: true, cellMinWidth: 80 } }),
    VaultImage.configure({ inline: false, allowBase64: false, resolve: resolveImage }),
    InlineMath.configure({
      katexOptions,
      onClick: onMathClick ? (node, pos) => onMathClick(node, pos, "inline") : undefined,
    }),
    BlockMath.configure({
      katexOptions: { ...katexOptions, displayMode: true },
      onClick: onMathClick ? (node, pos) => onMathClick(node, pos, "block") : undefined,
    }),
    DollarMath.configure({ onBlockCreated: onBlockMathCreated }),
    TextColor,
    ColorHighlight,
    LastColor,
    Markdown.configure({ indentation: { style: "space", size: 2 } }),
  ]
}
