import { Editor } from '@tiptap/core'
import { expect, it } from 'vitest'
import { buildExtensions } from './extensions'

it('```mermaid остаётся блоком кода с языком и сохраняется как был', () => {
  const md = '# Схема\n\n```mermaid\nflowchart TD\n  S[Виды] --> A[Потребители]\n```'
  const editor = new Editor({ extensions: buildExtensions(), content: md, contentType: 'markdown' })
  const block = editor.state.doc.child(1)
  expect(block.type.name).toBe('codeBlock')
  expect(block.attrs.language).toBe('mermaid')
  expect(editor.getMarkdown().trim()).toBe(md)
  editor.destroy()
})
