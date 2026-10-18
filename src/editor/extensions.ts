import { Extension, InputRule } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { ColorHighlight, LastColor, TextColor } from './colors'

export const katexOptions = { throwOnError: false, strict: 'ignore' as const }

/**
 * Привычный ввод формул:
 *   $x^2$       → inline-формула (плагин ниже, работает и для вставки)
 *   $$ + пробел  в начале пустой строки → блочная формула
 * (у официального расширения: $$x$$ и $$$x$$$ — неудобно)
 */
export const DollarMath = Extension.create<{ onBlockCreated?: (pos: number) => void }>({
  name: 'dollarMath',
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
          if ($from.parent.textContent.trim() !== '$$') return null
          const pos = $from.before()
          chain()
            .deleteRange({ from: pos, to: $from.after() })
            .insertContentAt(pos, { type: block.name, attrs: { latex: '' } })
            .run()
          // открыть редактор формулы, когда view обновится
          if (onBlockCreated) setTimeout(() => onBlockCreated(pos))
        },
      }),
    ]
  },
  addProseMirrorPlugins() {
    const inline = this.editor.schema.nodes.inlineMath
    const block = this.editor.schema.nodes.blockMath
    // Формулы, записанные текстом, → узлы формул. Ловит набор, вставку и автозамену:
    //   $…$ и \(…\) в строке; абзац целиком из \[…\] или $$…$$ — блочная формула.
    return [
      new Plugin({
        key: new PluginKey('dollarMathConvert'),
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null
          const ops: { from: number; to: number; node: PMNode }[] = []
          state.doc.descendants((node, pos, parent) => {
            if (node.type.name === 'paragraph' && parent?.canReplaceWith(0, 0, block)) {
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

/** $x$: без пробелов у краёв (чтобы «$5 и $10» не ломались), не после \ и не внутри $$. */
const INLINE_DOLLAR = /(^|[^$\\])\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?!\$)/g
/** \( x \) — так пишет формулы ChatGPT. */
const INLINE_PAREN = /\\\(\s*([^\n]+?)\s*\\\)/g
/** Абзац, целиком состоящий из \[ … \] или $$ … $$. */
const BLOCK_TEXT = /^\s*(?:\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$)\s*$/

export interface ExtensionOptions {
  onMathClick?: (node: PMNode, pos: number, kind: 'inline' | 'block') => void
  onBlockMathCreated?: (pos: number) => void
  /** Относительный путь картинки из Markdown → URL для <img>. */
  resolveImage?: (src: string) => Promise<string | null>
}

/** Картинка, чей src — путь внутри vault («assets/x.webp»), а не URL. */
const VaultImage = Image.extend<{ resolve?: ExtensionOptions['resolveImage'] } & Record<string, unknown>>({
  addOptions() {
    return { ...this.parent?.(), resolve: undefined }
  },
  addNodeView() {
    const resolve = this.options.resolve
    return ({ node }) => {
      const img = document.createElement('img')
      img.alt = node.attrs.alt ?? ''
      img.draggable = true
      const src: string = node.attrs.src ?? ''
      if (resolve && src && !/^(https?:|data:|blob:)/.test(src)) {
        img.dataset.loading = 'true'
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

/** Общий набор расширений: редактор и (без UI-опций) тесты сериализации. */
export function buildExtensions({ onMathClick, onBlockMathCreated, resolveImage }: ExtensionOptions = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // таблицы: в Markdown — GFM `| a | b |`; обёртка даёт горизонтальную прокрутку широким
    TableKit.configure({ table: { renderWrapper: true, cellMinWidth: 80 } }),
    VaultImage.configure({ inline: false, allowBase64: false, resolve: resolveImage }),
    InlineMath.configure({
      katexOptions,
      onClick: onMathClick ? (node, pos) => onMathClick(node, pos, 'inline') : undefined,
    }),
    BlockMath.configure({
      katexOptions: { ...katexOptions, displayMode: true },
      onClick: onMathClick ? (node, pos) => onMathClick(node, pos, 'block') : undefined,
    }),
    DollarMath.configure({ onBlockCreated: onBlockMathCreated }),
    TextColor,
    ColorHighlight,
    LastColor,
    Markdown.configure({ indentation: { style: 'space', size: 2 } }),
  ]
}
