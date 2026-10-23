import { describe, expect, it } from 'vitest'
import { boardText, mergeBoards, parseBoard, serializeBoard, type BoardData, type BoardNode } from './model'

const card = (id: string, text: string, x = 0): BoardNode => ({ id, type: 'text', x, y: 0, width: 200, height: 80, text })

describe('файл доски', () => {
  it('читает доску из Obsidian (JSON Canvas) и пишет её обратно с id', () => {
    const obsidian = JSON.stringify({
      nodes: [
        { id: 'a1', type: 'text', x: 10.4, y: -20, width: 250, height: 60, text: '# Тема', color: '4' },
        { id: 'g1', type: 'group', x: -50, y: -80, width: 600, height: 400, label: 'Раздел', background: 'x.png' },
        { id: 'f1', type: 'file', x: 300, y: 0, width: 200, height: 150, file: 'Физика/Доски/assets/a.webp' },
      ],
      edges: [{ id: 'e1', fromNode: 'a1', fromSide: 'right', toNode: 'f1', toSide: 'left', toEnd: 'arrow', label: 'пример' }],
    })
    const { id, data } = parseBoard(obsidian)
    expect(id).toBeUndefined()
    expect(data.nodes.map((n) => n.type)).toEqual(['text', 'group', 'file'])
    expect(data.edges[0]).toMatchObject({ fromNode: 'a1', toNode: 'f1', fromSide: 'right', label: 'пример' })

    const again = parseBoard(serializeBoard('b1', data))
    expect(again.id).toBe('b1')
    expect(again.data.nodes[0].x).toBe(10)
    expect(again.data).toEqual({ ...data, nodes: data.nodes.map((n) => ({ ...n, x: Math.round(n.x) })) })
  })

  it('битый файл и чужие поля не роняют доску', () => {
    expect(parseBoard('{не json').data).toEqual({ nodes: [], edges: [] })
    expect(parseBoard('null').data).toEqual({ nodes: [], edges: [] })
    const { data } = parseBoard(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 'x', text: 'ok', color: 'red;background:url(x)' },
          { id: 'a', type: 'text', text: 'повтор id' },
          { id: 'b', type: 'circle' },
          { type: 'text' },
        ],
        edges: [
          { id: 'e1', fromNode: 'a', toNode: 'нет' },
          { id: 'e2', fromNode: 'a', toNode: 'a', color: '#ff0000' },
        ],
      }),
    )
    expect(data.nodes).toEqual([{ id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, color: undefined, text: 'ok' }])
    expect(data.edges.map((e) => [e.id, e.color])).toEqual([['e2', '#ff0000']])
  })

  it('текст для поиска — карточки, подписи рамок и стрелок', () => {
    const data: BoardData = {
      nodes: [card('a', 'Энтропия'), { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300, label: 'Термодинамика' }],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'g', label: 'растёт' }],
    }
    expect(boardText(data)).toBe('Энтропия\nТермодинамика\nрастёт')
  })
})

describe('слияние правок доски', () => {
  const base: BoardData = { nodes: [card('a', 'А'), card('b', 'Б', 300)], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] }

  it('правки здесь и снаружи в разных карточках — обе остаются', () => {
    const local = { ...base, nodes: [{ ...base.nodes[0], x: 50 }, base.nodes[1], card('c', 'моя новая')] }
    const disk = { ...base, nodes: [base.nodes[0], { ...base.nodes[1], text: 'Б от Claude' }, card('d', 'от Claude')] }
    const merged = mergeBoards(base, local, disk)
    expect(merged.nodes.map((n) => [n.id, n.x, n.text])).toEqual([
      ['a', 50, 'А'],
      ['b', 300, 'Б от Claude'],
      ['c', 0, 'моя новая'],
      ['d', 0, 'от Claude'],
    ])
    expect(merged.edges).toHaveLength(1)
  })

  it('одну карточку правили в обоих местах — побеждает правка здесь', () => {
    const local = { ...base, nodes: [{ ...base.nodes[0], text: 'моё' }, base.nodes[1]] }
    const disk = { ...base, nodes: [{ ...base.nodes[0], text: 'чужое' }, base.nodes[1]] }
    expect(mergeBoards(base, local, disk).nodes[0].text).toBe('моё')
  })

  it('удаление снаружи применяется, если карточку здесь не трогали; стрелки к удалённым уходят', () => {
    const disk = { nodes: [base.nodes[0]], edges: [] }
    expect(mergeBoards(base, base, disk)).toEqual({ nodes: [base.nodes[0]], edges: [] })

    const local = { ...base, nodes: [base.nodes[0], { ...base.nodes[1], text: 'правлю' }] }
    expect(mergeBoards(base, local, disk).nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('удалённое здесь не возвращается из файла', () => {
    const local = { nodes: [base.nodes[1]], edges: [] }
    expect(mergeBoards(base, local, base)).toEqual(local)
  })
})
