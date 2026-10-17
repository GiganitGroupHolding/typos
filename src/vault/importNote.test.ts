import { describe, expect, it } from 'vitest'
import { sampleVault } from '@/test/sampleVault'
import * as repo from './repo'

const physics = async () => {
  const a = sampleVault()
  const v = await repo.loadVault(a)
  return { a, s: v.subjects.find((x) => x.name === 'Физика')! }
}

describe('импорт .md', () => {
  it('заголовок берётся из первой строки, чужой frontmatter сохраняется', async () => {
    const { a, s } = await physics()
    const text = '---\nid: чужой-id\ncreated: 2026-09-01T10:00:00.000Z\nsource: https://example.com/lecture\n---\n\n# Колебания\n\nПериод \\(T = 2\\pi\\sqrt{l/g}\\)'
    const n = await repo.importNote(a, s, { name: 'whatever.md', text })
    expect(n.path).toBe('Физика/Конспекты/Колебания.md')
    expect(n.id).not.toBe('чужой-id')
    expect(n.created).toBe('2026-09-01T10:00:00.000Z')
    expect(n.meta).toEqual({ source: 'https://example.com/lecture' })
    expect(n.body).toBe('# Колебания\n\nПериод $T = 2\\pi\\sqrt{l/g}$\n')
    const reloaded = (await repo.loadVault(a)).notes.find((x) => x.id === n.id)!
    expect(reloaded.body).toBe(n.body)
    expect(reloaded.meta.source).toBe('https://example.com/lecture')
  })

  it('без заголовка — заголовок из имени файла (кириллица, пробелы, NFD)', async () => {
    const { a, s } = await physics()
    const n = await repo.importNote(a, s, { name: 'Лекция 4 Волны и звук.md'.normalize('NFD'), text: 'Скорость звука ≈ 340 м/с' })
    expect(n.title).toBe('Лекция 4 Волны и звук')
    expect(n.path).toBe('Физика/Конспекты/Лекция 4 Волны и звук.md')
    expect(n.body.startsWith('# Лекция 4 Волны и звук\n\nСкорость звука')).toBe(true)
  })

  it('картинки из того же набора файлов копируются в assets, ссылки переписываются', async () => {
    const { a, s } = await physics()
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/gif' })
    const text = '# Схема\n\n![маятник](img/Маятник%201.gif) и ![нет такой](missing.png) и ![веб](https://x.y/z.png)'
    const n = await repo.importNote(a, s, { name: 'Схема.md', text, images: new Map([['маятник 1.gif', png]]) })
    const [, rel] = n.body.match(/!\[маятник\]\((assets\/[a-z0-9]+\.gif)\)/) ?? []
    expect(rel).toBeTruthy()
    expect(await a.exists(`Физика/Конспекты/${rel}`)).toBe(true)
    expect(n.body).toContain('![нет такой](missing.png)')
    expect(n.body).toContain('![веб](https://x.y/z.png)')
  })

  it('одинаковые названия не затирают друг друга', async () => {
    const { a, s } = await physics()
    const one = await repo.importNote(a, s, { name: 'a.md', text: '# Кинематика точки' })
    expect(one.path).toBe('Физика/Конспекты/Кинематика точки (2).md')
  })
})
