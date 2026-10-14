import { describe, expect, it } from 'vitest'
import { createMemoryAdapter } from '@/storage/flatAdapter'
import * as repo from './repo'
import { sampleVault } from '@/test/sampleVault'

describe('vault repo', () => {
  it('load: предметы, конспекты, закреп, тулзы', async () => {
    const a = sampleVault()
    const v = await repo.loadVault(a)
    expect(v.subjects.map((s) => s.name)).toEqual(['Линейная алгебра', 'Физика', 'Алгоритмы', 'История'])
    expect(v.notes).toHaveLength(7)
    expect(v.pins.filter((p) => p.subjectId === v.subjects[0].id).map((p) => p.title)[0]).toBe('Определитель 2×2')
    expect(v.tools.find((t) => t.name === 'Калькулятор матриц')?.icon).toBe('grid')
  })

  it('создание → сохранение переименовывает файл по заголовку', async () => {
    const a = sampleVault()
    const { subjects } = await repo.loadVault(a)
    const note = await repo.createNote(a, subjects[1])
    expect(note.path).toBe('Физика/Конспекты/Без названия.md')

    const saved = await repo.saveNote(a, note, '# Импульс: закон сохранения\n\n$p = mv$')
    expect(saved.path).toBe('Физика/Конспекты/Импульс закон сохранения.md')
    expect(saved.title).toBe('Импульс: закон сохранения')
    expect(await a.exists(note.path)).toBe(false)

    const again = await repo.saveNote(a, saved, '# Импульс: закон сохранения\n\n$p = mv$, правка')
    expect(again.path).toBe(saved.path)

    const reloaded = (await repo.loadVault(a)).notes.find((n) => n.id === note.id)
    expect(reloaded?.body).toBe('# Импульс: закон сохранения\n\n$p = mv$, правка')
  })

  it('одинаковые заголовки не перезаписывают друг друга', async () => {
    const a = sampleVault()
    const { subjects } = await repo.loadVault(a)
    const n1 = await repo.saveNote(a, await repo.createNote(a, subjects[3]), '# Лекция')
    const n2 = await repo.saveNote(a, await repo.createNote(a, subjects[3]), '# Лекция')
    expect(n1.path).not.toBe(n2.path)
    expect(n2.path).toBe('История/Конспекты/Лекция (2).md')
  })

  it('корзина и восстановление', async () => {
    const a = sampleVault()
    const { notes } = await repo.loadVault(a)
    const n = notes[0]
    const trash = await repo.trashNote(a, n)
    expect(await a.exists(n.path)).toBe(false)
    expect((await repo.loadVault(a)).notes.some((x) => x.id === n.id)).toBe(false)
    await repo.restoreFromTrash(a, trash, n.path)
    expect((await repo.loadVault(a)).notes.find((x) => x.id === n.id)?.body).toBe(n.body)
  })

  it('папка, созданная руками, становится предметом', async () => {
    const a = createMemoryAdapter({ 'Химия/Конспекты/Моль.md': '# Моль\n\nКоличество вещества' })
    const v = await repo.loadVault(a)
    expect(v.subjects[0].name).toBe('Химия')
    expect(v.notes[0].title).toBe('Моль')
    expect(await a.exists('Химия/_subject.json')).toBe(true)
  })

  it('перенос браузер → папка: всё копируется, существующее не перезаписывается, корзина пропускается', async () => {
    const browser = sampleVault()
    const n = (await repo.loadVault(browser)).notes[0]
    await repo.trashNote(browser, (await repo.loadVault(browser)).notes[1])
    const folder = createMemoryAdapter({ [n.path]: '# Моя версия' })

    const copied = await repo.copyVault(browser, folder)
    expect(copied).toBeGreaterThan(10)
    expect(await folder.readText(n.path)).toBe('# Моя версия')
    expect(await folder.list('.studynotes')).toEqual([])
    expect((await repo.loadVault(folder)).subjects).toHaveLength(4)
  })

  it('новый предмет: безопасное имя папки и без коллизий', async () => {
    const a = createMemoryAdapter()
    const s1 = await repo.createSubject(a, { name: 'Мат/анализ: 1 курс', color: 'blue', icon: 'sigma' }, 0)
    expect(s1.dir).toBe('Мат анализ 1 курс')
    const s2 = await repo.createSubject(a, { name: 'Мат/анализ: 1 курс', color: 'rose', icon: 'book' }, 1)
    expect(s2.dir).toBe('Мат анализ 1 курс (2)')
    const v = await repo.loadVault(a)
    expect(v.subjects.map((s) => [s.name, s.color])).toEqual([['Мат анализ 1 курс', 'blue'], ['Мат анализ 1 курс (2)', 'rose']])
  })

  it('картинка сохраняется рядом с конспектом', async () => {
    const a = sampleVault()
    const n = (await repo.loadVault(a)).notes[0]
    const rel = await repo.saveAsset(a, 'Физика/Конспекты', new Blob(['x'], { type: 'image/gif' }))
    expect(rel).toMatch(/^assets\/\w+\.gif$/)
    expect(await a.exists(`Физика/Конспекты/${rel}`)).toBe(true)
    expect((await repo.loadVault(a)).notes.find((x) => x.id === n.id)).toBeTruthy()
  })
})
