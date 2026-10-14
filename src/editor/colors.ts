import { Extension, Mark } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'

/**
 * Цвет текста и фона — палитра как в Notion.
 * В Markdown цвета нет, поэтому пишем inline-HTML (Obsidian покажет текст, ничего не теряется):
 *   цвет текста     → <span data-text-color="red">…</span>
 *   цветной фон     → <mark data-color="green">…</mark>
 *   простой маркер  → ==…==
 */

export const NOTE_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export const COLOR_LABELS: Record<NoteColor, string> = {
  gray: 'Серый',
  brown: 'Коричневый',
  orange: 'Оранжевый',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  blue: 'Синий',
  purple: 'Фиолетовый',
  pink: 'Розовый',
  red: 'Красный',
}

const isColor = (c: unknown): c is NoteColor => typeof c === 'string' && (NOTE_COLORS as readonly string[]).includes(c)

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: NoteColor) => ReturnType
      unsetTextColor: () => ReturnType
    }
    lastColor: {
      /** Ctrl+Shift+H: применить последний выбранный цвет (как в Notion). */
      applyLastColor: () => ReturnType
    }
  }
  interface Storage {
    lastColor: { last: { kind: 'text' | 'bg'; color: NoteColor } | null }
  }
}

export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (isColor(el.getAttribute('data-text-color')) ? el.getAttribute('data-text-color') : null),
        renderHTML: (a) => (isColor(a.color) ? { 'data-text-color': a.color } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-text-color]', getAttrs: (el) => (isColor((el as HTMLElement).getAttribute('data-text-color')) ? null : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },
  renderMarkdown: (node, h) => `<span data-text-color="${node.attrs?.color}">${h.renderChildren(node)}</span>`,
  parseMarkdown: (token, h) => h.applyMark('textColor', h.parseInline(token.tokens || []), { color: token.color }),
  markdownTokenizer: {
    name: 'textColor',
    level: 'inline',
    start: (src) => src.indexOf('<span data-text-color='),
    tokenize(src, _tokens, h) {
      const m = /^<span data-text-color="([a-z]+)">([\s\S]+?)<\/span>/.exec(src)
      if (!m || !isColor(m[1])) return
      return { type: 'textColor', raw: m[0], color: m[1], text: m[2], tokens: h.inlineTokens(m[2]) }
    },
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

export const ColorHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (isColor(el.getAttribute('data-color')) ? el.getAttribute('data-color') : null),
        renderHTML: (a) => (isColor(a.color) ? { 'data-color': a.color } : {}),
      },
    }
  },
  // Ctrl+Shift+H занят под «последний цвет»
  addKeyboardShortcuts() {
    return {}
  },
  renderMarkdown: (node, h) =>
    isColor(node.attrs?.color) ? `<mark data-color="${node.attrs.color}">${h.renderChildren(node)}</mark>` : `==${h.renderChildren(node)}==`,
  parseMarkdown: (token, h) => h.applyMark('highlight', h.parseInline(token.tokens || []), token.color ? { color: token.color } : undefined),
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src) => {
      const a = src.indexOf('==')
      const b = src.indexOf('<mark data-color=')
      return a < 0 ? b : b < 0 ? a : Math.min(a, b)
    },
    tokenize(src, _tokens, h) {
      let m = /^==([^=]+)==/.exec(src)
      if (m) return { type: 'highlight', raw: m[0], text: m[1], tokens: h.inlineTokens(m[1].trim()) }
      m = /^<mark data-color="([a-z]+)">([\s\S]+?)<\/mark>/.exec(src)
      if (m && isColor(m[1])) return { type: 'highlight', raw: m[0], color: m[1], text: m[2], tokens: h.inlineTokens(m[2]) }
    },
  },
}).configure({ multicolor: true })

/** Запоминает последний цвет и применяет его по Ctrl+Shift+H. */
export const LastColor = Extension.create({
  name: 'lastColor',
  addStorage() {
    return { last: null as { kind: 'text' | 'bg'; color: NoteColor } | null }
  },
  addCommands() {
    return {
      applyLastColor:
        () =>
        ({ chain }) => {
          const last = this.storage.last
          if (!last) return false
          return last.kind === 'text' ? chain().setTextColor(last.color).run() : chain().setHighlight({ color: last.color }).run()
        },
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.applyLastColor() }
  },
})
