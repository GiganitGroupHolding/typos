import CodeBlock, { type CodeBlockOptions } from '@tiptap/extension-code-block'
import type { Node as PMNode } from '@tiptap/pm/model'
import { mapSlots } from './map/slots'
import { codeHash } from './map/types'

type MermaidApi = typeof import('mermaid').default
let loading: Promise<MermaidApi> | null = null
const loadMermaid = () => (loading ??= import('mermaid').then((m) => m.default))

const isDark = () => document.documentElement.classList.contains('dark')

const PALETTE = {
  light: {
    primaryColor: '#ffffff',
    primaryTextColor: '#1f1e1d',
    primaryBorderColor: '#d6d3cb',
    lineColor: '#9b988f',
    secondaryColor: '#f4f3ef',
    tertiaryColor: '#f8f7f4',
  },
  dark: {
    primaryColor: '#1c1c1d',
    primaryTextColor: '#f2f2f0',
    primaryBorderColor: '#3d3d3f',
    lineColor: '#8a8a88',
    secondaryColor: '#242425',
    tertiaryColor: '#202021',
  },
}

const DIAGRAM_CSS = `
  .node rect, .node polygon, .node circle, .node ellipse, .node path { stroke-width: 1px; }
  .node rect { rx: 10px; ry: 10px; }
  .node, .node * { filter: none !important; }
  .flowchart-link, .edgePath .path { stroke-width: 1.2px; }
  .label, .nodeLabel, .edgeLabel { line-height: 1.45; font-weight: 400; }
`

let seq = 0
async function renderDiagram(code: string): Promise<string> {
  const mermaid = await loadMermaid()
  const dark = isDark()
  const fontFamily = getComputedStyle(document.body).fontFamily
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    look: 'classic',

    layout: 'dagre',
    fontFamily,

    flowchart: { curve: 'basis', padding: 14, nodeSpacing: 28, rankSpacing: 40, useMaxWidth: false, wrappingWidth: 220 },
    themeCSS: DIAGRAM_CSS,
    themeVariables: { ...(dark ? PALETTE.dark : PALETTE.light), darkMode: dark, background: 'transparent', fontFamily, fontSize: '15px' },
  })
  const id = `diagram-${++seq}`
  try {
    return (await mermaid.render(id, code)).svg
  } finally {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
  }
}

const MIN_SCALE = 0.8
function fit(view: HTMLElement) {
  const svg = view.querySelector('svg')
  if (!svg) return
  const natural = svg.viewBox.baseVal?.width || Number(svg.getAttribute('width')) || 0
  if (!natural) return
  const room = view.clientWidth - parseFloat(getComputedStyle(view).paddingLeft) * 2
  svg.style.width = `${natural * Math.max(MIN_SCALE, Math.min(1, room / natural))}px`
}

export interface DiagramCodeBlockOptions extends CodeBlockOptions {
  diagrams: boolean
}

export const DiagramCodeBlock = CodeBlock.extend<DiagramCodeBlockOptions>({
  addOptions() {
    return { ...this.parent!(), diagrams: false }
  },

  addNodeView() {
    if (!this.options.diagrams) return null
    const prefix = this.options.languageClassPrefix ?? 'language-'
    return ({ node, editor, getPos }) => {
      const lang = node.attrs.language as string | null

      if (lang !== 'mermaid') {
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        if (lang) code.className = `${prefix}${lang}`
        pre.append(code)
        return { dom: pre, contentDOM: code, update: (n: PMNode) => n.type === node.type && n.attrs.language === lang }
      }

      const dom = document.createElement('div')
      dom.className = 'diagram-block'
      const view = document.createElement('div')
      view.className = 'diagram-view'
      view.contentEditable = 'false'
      const slot = document.createElement('div')
      slot.className = 'diagram-map-slot'
      slot.contentEditable = 'false'
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.className = `${prefix}mermaid`
      pre.append(code)
      dom.append(view, slot, pre)

      let current = node
      let inside = false
      let failed = false
      let version = 0
      let timer = 0
      let dark = isDark()
      let mapped = false
      let stale = true

      const sync = () => dom.toggleAttribute('data-editing', inside || (failed && !mapped) || !current.textContent.trim())

      const applySlot = () => {
        const hash = codeHash(current.textContent)
        const h = mapSlots.height(hash)
        dom.dataset.mapHash = hash
        mapped = h !== undefined
        dom.toggleAttribute('data-mapped', mapped)
        slot.style.height = mapped ? `${h}px` : ''
        if (!mapped && stale) void draw()
        sync()
      }

      const draw = async () => {
        if (mapped) return
        stale = false
        const text = current.textContent
        const mine = ++version
        if (!text.trim()) {
          view.replaceChildren()
          failed = false
          return sync()
        }
        try {
          const svg = await renderDiagram(text)
          if (mine !== version) return
          view.innerHTML = svg
          fit(view)
          failed = false
        } catch (e) {
          if (mine !== version) return
          const err = document.createElement('div')
          err.className = 'diagram-error'
          err.textContent = `Схема не рисуется: ${String((e as Error)?.message ?? e).split('\n')[0]}`
          view.replaceChildren(err)
          failed = true
        }
        sync()
      }

      const openCode = (e: MouseEvent) => {
        e.preventDefault()
        const pos = getPos()
        if (pos === undefined || !editor.isEditable) return

        inside = true
        sync()
        editor
          .chain()
          .focus()
          .setTextSelection(pos + 1 + current.content.size)
          .run()
      }
      view.addEventListener('mousedown', openCode)
      slot.addEventListener('mousedown', openCode)
      const unsubscribe = mapSlots.subscribe(applySlot)

      const onSelection = () => {
        const pos = getPos()
        if (pos === undefined) return
        const { from, to } = editor.state.selection
        const now = from > pos && to < pos + current.nodeSize
        if (now !== inside) {
          inside = now
          sync()
        }
      }
      editor.on('selectionUpdate', onSelection)

      const themeWatch = new MutationObserver(() => {
        if (isDark() !== dark) {
          dark = isDark()
          redraw()
        }
      })
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      const redraw = () => {
        stale = true
        if (!mapped) void draw()
      }

      const resize = new ResizeObserver(() => fit(view))
      resize.observe(view)

      applySlot()

      return {
        dom,
        contentDOM: code,
        update(n: PMNode) {
          if (n.type !== current.type || n.attrs.language !== 'mermaid') return false
          const changed = n.textContent !== current.textContent
          current = n
          if (changed) {
            stale = true
            clearTimeout(timer)
            timer = window.setTimeout(applySlot, 350)
          }
          return true
        },

        ignoreMutation: (m) => m.type !== 'selection' && (!code.contains(m.target) || (m.type === 'attributes' && m.target === code)),
        stopEvent: (e: Event) => view.contains(e.target as Node) || slot.contains(e.target as Node),
        destroy() {
          unsubscribe()
          editor.off('selectionUpdate', onSelection)
          themeWatch.disconnect()
          resize.disconnect()
          clearTimeout(timer)
          version++
        },
      }
    }
  },
})
