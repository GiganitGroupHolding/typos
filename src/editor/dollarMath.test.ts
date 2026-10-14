import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExtensions } from './extensions'

let editor: Editor
afterEach(() => editor?.destroy())

const make = () => (editor = new Editor({ extensions: buildExtensions(), content: '<p></p>' }))
const types = () => {
  const out: string[] = []
  editor.state.doc.descendants((n) => void (n.isInline && out.push(n.isText ? `t:${n.text}` : `${n.type.name}:${n.attrs.latex}`)))
  return out
}

describe('$…$ → формула', () => {
  it('вставка текста целиком превращается в формулу', () => {
    make()
    editor.commands.insertContent('Быстрая сортировка $n \log n$ сравнений')
    expect(types()).toEqual(['t:Быстрая сортировка ', 'inlineMath:n \log n', 't: сравнений'])
    expect(editor.getMarkdown().trim()).toBe('Быстрая сортировка $n \log n$ сравнений')
  })

  it('несколько формул в строке', () => {
    make()
    editor.commands.insertContent('$a$ и $b^2$')
    expect(types()).toEqual(['inlineMath:a', 't: и ', 'inlineMath:b^2'])
  })

  it('деньги и пробелы у краёв — не формула', () => {
    make()
    editor.commands.insertContent('стоит $5 и $10, а $ x $ тоже текст')
    expect(types()).toEqual(['t:стоит $5 и $10, а $ x $ тоже текст'])
  })

  it('внутри кода не трогаем', () => {
    make()
    editor.commands.setContent('```\nprice = $a$\n```', { contentType: 'markdown' })
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(editor.state.doc.firstChild?.textContent).toBe('price = $a$')
  })
})
