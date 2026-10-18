import { describe, expect, it } from 'vitest'
import { sampleVault } from '@/test/sampleVault'
import * as repo from '@/vault/repo'
import { edgePath, facingSides, rectOf } from './geometry'

describe('геометрия карты', () => {
  it('стрелка идёт между сторонами, которые смотрят друг на друга', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 }
    expect(facingSides(a, { x: 300, y: 10, w: 100, h: 40 })).toEqual(['right', 'left'])
    expect(facingSides(a, { x: 20, y: 200, w: 100, h: 40 })).toEqual(['bottom', 'top'])
    expect(facingSides(a, { x: 0, y: -200, w: 100, h: 40 })).toEqual(['top', 'bottom'])
    expect(edgePath(a, { x: 300, y: 0, w: 100, h: 40 }).d.startsWith('M100 20C')).toBe(true)
  })

  it('прямоугольник по двум углам в любую сторону', () => {
    expect(rectOf(50, 80, 10, 20)).toEqual({ x: 10, y: 20, w: 40, h: 60 })
  })
})

describe('файл карты в хранилище', () => {
  it('лежит в Конспекты/.maps, текст блоков попадает в поиск, пустая карта удаляет файл', async () => {
    const a = sampleVault()
    const v = await repo.loadVault(a)
    const note = v.notes[0]
    const map = {
      version: 1 as const,
      groups: [{ id: 'g', anchor: { kind: 'abs' as const, y: 0 } }],
      nodes: [{ id: 'n', group: 'g', x: 0, y: 0, w: 120, h: 44, text: 'Ёмкость рынка' }],
      edges: [],
    }
    await repo.saveNoteMap(a, note, map)
    const path = repo.noteMapPath(note)
    expect(path).toMatch(/\/Конспекты\/\.maps\/.+\.json$/)
    expect(await repo.loadNoteMap(a, note)).toEqual(map)
    const again = await repo.loadVault(a)
    expect(again.notes.find((n) => n.id === note.id)?.mapText).toBe('Ёмкость рынка')
    expect(again.notes).toHaveLength(v.notes.length)
    await repo.saveNoteMap(a, note, { ...map, nodes: [] })
    expect(await a.exists(path)).toBe(false)
  })
})
