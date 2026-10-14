// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExtensions } from './extensions'
import { htmlMathToNodes, looksLikeMarkdown, looksLikeTex, normalizeMarkdownMath } from './texImport'

const r = String.raw

describe('looksLikeTex', () => {
  it('формулы', () => {
    expect(looksLikeTex(r`E = \frac{\Delta Q / Q}{\Delta P / P}`)).toBe(true)
    expect(looksLikeTex('x_1 = a^2 + b')).toBe(true)
  })
  it('код — не формула', () => {
    expect(looksLikeTex('const x = a_b;')).toBe(false)
    expect(looksLikeTex('def f(x):\n    return x**2')).toBe(false)
    expect(looksLikeTex('npm install')).toBe(false)
  })
})

describe('normalizeMarkdownMath', () => {
  it('блок кода с LaTeX без языка → $$', () => {
    const md = 'Эластичность:\n\n```\nE = \\frac{\\Delta Q / Q}{\\Delta P / P}\n```\n'
    expect(normalizeMarkdownMath(md)).toBe('Эластичность:\n\n$$\nE = \\frac{\\Delta Q / Q}{\\Delta P / P}\n$$\n')
  })
  it('```latex → $$', () => {
    expect(normalizeMarkdownMath('```latex\nx^2\n```')).toBe('$$\nx^2\n$$')
  })
  it('обычный код не трогает', () => {
    const md = '```js\nconst a = 1;\n```\n\n```\nnpm i\n```'
    expect(normalizeMarkdownMath(md)).toBe(md)
  })
  it(r`\[ \] и \( \)`, () => {
    expect(normalizeMarkdownMath(r`Текст \(x^2\) и \[ \sum_i a_i \] конец`)).toBe('Текст $x^2$ и \n\n$$\n\\sum_i a_i\n$$\n\n конец')
  })
  it('модуль |x| в формуле внутри таблицы', () => {
    const md = '| Тип | Условие |\n|---|---|\n| Эластичный | $|E|>1$ |'
    expect(normalizeMarkdownMath(md)).toBe('| Тип | Условие |\n|---|---|\n| Эластичный | $\\|E\\|>1$ |')
    const editor = new Editor({ extensions: buildExtensions(), content: normalizeMarkdownMath(md), contentType: 'markdown' })
    const cells: string[] = []
    editor.state.doc.descendants((n) => void (n.type.name === 'inlineMath' && cells.push(n.attrs.latex)))
    expect(cells).toEqual(['|E|>1'])
    // при сохранении таблица остаётся таблицей, а формула — целой
    const saved = editor.getMarkdown()
    expect(normalizeMarkdownMath(saved)).toBe(saved)
    const again = new Editor({ extensions: buildExtensions(), content: saved, contentType: 'markdown' })
    expect(again.state.doc.firstChild?.type.name).toBe('table')
    expect(again.state.doc.textBetween(0, again.state.doc.content.size, ' ', (n) => n.attrs.latex ?? '')).toContain('|E|>1')
    again.destroy()
    editor.destroy()
  })
  it(r`\( внутри кода не трогает`, () => {
    const md = '```\nprint(r"\\(x\\)")\n```'
    expect(normalizeMarkdownMath(md)).toBe(md)
  })
})

describe('looksLikeMarkdown', () => {
  it('распознаёт', () => {
    expect(looksLikeMarkdown('# Заголовок\nтекст')).toBe(true)
    expect(looksLikeMarkdown('```\nx\n```')).toBe(true)
    expect(looksLikeMarkdown(r`формула \(x\)`)).toBe(true)
    expect(looksLikeMarkdown('просто текст')).toBe(false)
  })
})

describe('htmlMathToNodes', () => {
  it('KaTeX с аннотацией', () => {
    const html =
      '<p>a <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">x2</span></span></p>' +
      '<span class="katex-display"><span class="katex"><math><semantics><annotation encoding="application/x-tex">\\int f</annotation></semantics></math></span></span>'
    const out = htmlMathToNodes(html)
    expect(out).toContain('<span data-type="inline-math" data-latex="x^2"></span>')
    expect(out).toContain('<div data-type="block-math" data-latex="\\int f"></div>')
    expect(out).not.toContain('katex')
  })
  it('<pre> с LaTeX → блочная формула, с кодом — остаётся', () => {
    const out = htmlMathToNodes('<pre><code>E = \\frac{a}{b}</code></pre><pre><code class="language-js">let a = 1;</code></pre>')
    expect(out).toContain('data-type="block-math"')
    expect(out).toContain('language-js')
  })
})

describe('редактор: \\( \\) и \\[ \\] при вводе', () => {
  let editor: Editor
  afterEach(() => editor?.destroy())
  const inline = () => {
    const out: string[] = []
    editor.state.doc.descendants((n) => void (n.isInline && out.push(n.isText ? `t:${n.text}` : `${n.type.name}:${n.attrs.latex}`)))
    return out
  }

  it(r`\(x\) в строке → inline`, () => {
    editor = new Editor({ extensions: buildExtensions(), content: '<p></p>' })
    editor.commands.insertContent(r`цена \( P_1 \) растёт`)
    expect(inline()).toEqual(['t:цена ', 'inlineMath:P_1', 't: растёт'])
  })

  it(r`абзац \[…\] → блочная формула`, () => {
    editor = new Editor({ extensions: buildExtensions(), content: '<p></p>' })
    editor.commands.insertContent(r`\[ E = mc^2 \]`)
    expect(editor.state.doc.firstChild?.type.name).toBe('blockMath')
    expect(editor.state.doc.firstChild?.attrs.latex).toBe('E = mc^2')
  })

  it('markdown с блоком кода LaTeX → формула', () => {
    editor = new Editor({ extensions: buildExtensions(), content: '<p></p>' })
    editor.commands.setContent(normalizeMarkdownMath('```\nE = \\frac{a}{b}\n```'), { contentType: 'markdown' })
    expect(editor.state.doc.firstChild?.type.name).toBe('blockMath')
  })
})
