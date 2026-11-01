export const TEX_LANGS = ['latex', 'tex', 'math', 'katex', 'mathematics', 'mathjax']

const CODE_HINTS =
  /;\s*$|=>|\b(function|const|let|var|def|return|class|import|from|print|console|#include|public|void|SELECT|elif|lambda)\b|^\s*(#|\/\/)/m

export function looksLikeTex(src: string): boolean {
  const s = src.trim()
  if (!s || s.split('\n').length > 10) return false
  if (CODE_HINTS.test(s)) return false
  const commands = s.match(/\\[a-zA-Z]+/g) ?? []
  const scripts = /[_^]\{[^}]*\}|[_^][a-zA-Z0-9]/.test(s)
  return commands.length > 0 || (scripts && /=/.test(s))
}

export const isTexCodeBlock = (lang: string | null | undefined, text: string) =>
  TEX_LANGS.includes((lang ?? '').toLowerCase()) ? text.trim().length > 0 : !lang && looksLikeTex(text)

export function normalizeMarkdownMath(md: string): string {
  const out: string[] = []

  const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)\n\1\2[ \t]*$/gm
  let last = 0
  for (const m of md.matchAll(fence)) {
    out.push(convertDelimiters(md.slice(last, m.index)))
    const [whole, , , lang, body] = m
    out.push(isTexCodeBlock(lang, body) ? `$$\n${body.trim()}\n$$` : whole)
    last = m.index! + whole.length
  }
  out.push(convertDelimiters(md.slice(last)))
  return out.join('')
}

function convertDelimiters(text: string): string {
  return text
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_m, tex: string) => `\n\n$$\n${tex.trim()}\n$$\n\n`)
    .replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_m, tex: string) => `$${tex.trim()}$`)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]*\|.*$/gm, escapeTablePipes)
}

const escapeTablePipes = (row: string) => row.replace(/\$[^$\n]+\$/g, (math) => math.replace(/(?<!\\)\|/g, '\\|'))

export function looksLikeMarkdown(text: string): boolean {
  if (/```|~~~|\$\$|\\\[|\\\(/.test(text)) return true
  if (/(^|\n)[^\n]*\|[^\n]*\n[ \t|:]*-[ \t|:-]*(\n|$)/.test(text)) return true
  return text.includes('\n') && /(^|\n)[ \t]{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/.test(text)
}

export function htmlMathToNodes(html: string): string {
  if (!/katex|mjx-|<math|MathJax|language-(la)?tex|language-math|<pre/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const replace = (el: Element, latex: string, block: boolean) => {
    const node = doc.createElement(block ? 'div' : 'span')
    node.setAttribute('data-type', block ? 'block-math' : 'inline-math')
    node.setAttribute('data-latex', latex.trim())
    el.replaceWith(node)
  }

  doc.querySelectorAll('.katex-display').forEach((el) => {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex) replace(el, tex, true)
  })
  doc.querySelectorAll('.katex').forEach((el) => {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex) replace(el, tex, false)
  })

  doc.querySelectorAll('math').forEach((el) => {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (tex) replace(el.closest('mjx-container') ?? el, tex, el.getAttribute('display') === 'block')
  })

  doc.querySelectorAll('script[type^="math/tex"]').forEach((el) => {
    replace(el, el.textContent ?? '', /mode=display/.test(el.getAttribute('type') ?? ''))
  })

  doc.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code') ?? pre
    const lang = [...code.classList, ...pre.classList].find((c) => c.startsWith('language-'))?.slice(9) ?? null
    const text = code.textContent ?? ''
    if (isTexCodeBlock(lang, text)) replace(pre, text, true)
  })

  return doc.body.innerHTML
}
