import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { buildExtensions } from '../extensions'
import { foldedBlocks, headingKey, sectionRange } from './sections'

const schema = getSchema(buildExtensions())
const h = (level: number, text: string) => schema.nodes.heading.create({ level }, schema.text(text))
const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text))
// 0 H1, 1 p, 2 H2 «А», 3 p, 4 H3, 5 p, 6 H2 «Б», 7 p
const doc = schema.nodes.doc.create(null, [h(1, 'Конспект'), p('вступление'), h(2, 'А'), p('а1'), h(3, 'А.1'), p('а2'), h(2, 'Б'), p('б1')])

describe('разделы под заголовками', () => {
  it('заголовку подчиняется всё до заголовка того же уровня или выше', () => {
    expect(sectionRange(doc, 2)).toEqual([2, 6])
    expect(sectionRange(doc, 4)).toEqual([4, 6])
    expect(sectionRange(doc, 6)).toEqual([6, 8])
    expect(sectionRange(doc, 0)).toEqual([0, 8])
    expect(sectionRange(doc, 3)).toEqual([3, 4])
  })

  it('свёрнутый раздел прячет содержимое, вложенный свёрнутый внутри не считается отдельно', () => {
    const f = foldedBlocks(doc, new Set([headingKey(doc.child(2)), headingKey(doc.child(4))]))
    expect(f.headings).toEqual([2])
    expect([...f.hidden].sort()).toEqual([3, 4, 5])
  })
})
