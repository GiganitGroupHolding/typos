import { describe, expect, it } from 'vitest'
import * as repo from './repo'
import { sampleVault } from '@/test/sampleVault'
import { fileKind } from './format'

const sample = async () => {
  const a = sampleVault()
  return { a, v: await repo.loadVault(a) }
}

describe('закреп', () => {
  it('создание, правка с переименованием, порядок переживает перезагрузку', async () => {
    const { a, v } = await sample()
    const phys = v.subjects.find((s) => s.name === 'Физика')!
    const p = await repo.createPin(a, phys, { title: 'Импульс', tex: 'p = mv' }, 5)
    expect(p.path).toBe('Физика/Закреп/Импульс.md')

    const p2 = await repo.updatePin(a, p, { title: 'Импульс тела', tex: '\\vec p = m\\vec v', text: 'векторная величина', order: 0 })
    expect(p2.path).toBe('Физика/Закреп/Импульс тела.md')
    expect(await a.exists(p.path)).toBe(false)

    const reloaded = (await repo.loadVault(a)).pins.find((x) => x.id === p.id)
    expect(reloaded).toMatchObject({ title: 'Импульс тела', tex: '\\vec p = m\\vec v', text: 'векторная величина', order: 0 })
  })
})

describe('тулзы', () => {
  it('импорт: id и иконка в <meta>, имя из <title>', async () => {
    const { a, v } = await sample()
    const html = '<!doctype html><html><head><title>Решатель СЛАУ</title></head><body>hi</body></html>'
    expect(repo.guessToolName(html, 'x.html')).toBe('Решатель СЛАУ')
    const t = await repo.importTool(a, v.subjects[0], { name: 'Решатель СЛАУ', html, icon: 'grid' })
    const loaded = (await repo.loadVault(a)).tools.find((x) => x.id === t.id)
    expect(loaded).toMatchObject({ name: 'Решатель СЛАУ', icon: 'grid', path: 'Линейная алгебра/Проекты/Решатель СЛАУ.html', kind: 'html' })
  })

  it('переименование сохраняет id (ссылки и окна не ломаются)', async () => {
    const { a, v } = await sample()
    const t = v.tools.find((x) => x.name === 'Конвертер единиц')!
    const t2 = await repo.updateTool(a, t, { name: 'Единицы СИ', icon: 'calculator' })
    const loaded = (await repo.loadVault(a)).tools.find((x) => x.name === 'Единицы СИ')!
    expect(loaded.id).toBe(t.id)
    expect(loaded.icon).toBe('calculator')
    expect(t2.path).toBe('Физика/Инструменты/Единицы СИ.html')
  })

  it('HTML без <head> получает meta корректно', () => {
    const out = repo.setHtmlMeta('<div>калькулятор</div>', 'studynotes-id', 'x1')
    expect(repo.getHtmlMeta(out, 'studynotes-id')).toBe('x1')
    expect(out).toContain('<div>калькулятор</div>')
  })
})

describe('проекты', () => {
  it('тип по расширению', () => {
    expect(fileKind('PNG')).toBe('image')
    expect(fileKind('pdf')).toBe('pdf')
    expect(fileKind('pptx')).toBe('pptx')
    expect(fileKind('docx')).toBe('docx')
    expect(fileKind('htm')).toBe('html')
    expect(fileKind('csv')).toBe('text')
    expect(fileKind('zip')).toBe('other')
  })

  it('миграция «Инструменты» → «Проекты»: файлы целиком, id сохраняются, занятые имена не затираются', async () => {
    const { a, v } = await sample()
    const before = v.tools.filter((t) => t.subjectId === 'la')
    await a.writeText('Линейная алгебра/Проекты/График функции.html', '<p>уже был</p>')
    await a.writeBlob('Линейная алгебра/Инструменты/Схема.png', new Blob([new Uint8Array([1, 2, 3])]))
    expect(await repo.migrateTools(a)).toBe(4)
    expect(await a.exists('Линейная алгебра/Инструменты')).toBe(false)
    expect(await a.readText('Линейная алгебра/Проекты/График функции.html')).toBe('<p>уже был</p>')
    const after = (await repo.loadVault(a)).tools.filter((t) => t.subjectId === 'la')
    for (const t of before) expect(after.find((x) => x.id === t.id)?.path).toMatch(/^Линейная алгебра\/Проекты\//)
    expect(after.map((t) => t.name).sort()).toEqual(['График функции', 'График функции (2)', 'Калькулятор матриц', 'Схема'])
    expect(after.find((t) => t.name === 'Схема')).toMatchObject({ kind: 'image', ext: 'png', size: 3, html: '' })
    expect(await repo.migrateTools(a)).toBe(0)
  })

  it('любой файл: имя по-русски с пробелами, байты как есть; переименование оставляет расширение', async () => {
    const { a, v } = await sample()
    const s = v.subjects.find((x) => x.name === 'Физика')!
    const bytes = new Uint8Array([37, 80, 68, 70, 45])
    const t = await repo.importProjectFile(a, s, { name: 'Лабораторная №3 — маятник.PDF'.normalize('NFD'), blob: new Blob([bytes]) })
    expect(t).toMatchObject({ path: 'Физика/Проекты/Лабораторная №3 — маятник.pdf', name: 'Лабораторная №3 — маятник', kind: 'pdf', size: 5 })
    expect(new Uint8Array(await (await a.readBlob(t.path))!.arrayBuffer())).toEqual(bytes)
    const r = await repo.updateTool(a, t, { name: 'Маятник: отчёт', icon: 'calculator' })
    expect(r.path).toBe('Физика/Проекты/Маятник отчёт.pdf')
    expect(await a.exists(t.path)).toBe(false)
    const html = await repo.importProjectFile(a, s, { name: 'Тренажёр.html', blob: new Blob(['<title>index</title><b>1</b>']) })
    expect(html).toMatchObject({ kind: 'html', name: 'Тренажёр', path: 'Физика/Проекты/Тренажёр.html' })
  })
})

describe('предметы и корзина', () => {
  it('переименование предмета переносит папку со всем содержимым', async () => {
    const { a, v } = await sample()
    const hist = v.subjects.find((s) => s.name === 'История')!
    const next = await repo.updateSubject(a, hist, { name: 'История России', color: 'teal', icon: 'book' })
    expect(next.dir).toBe('История России')
    const v2 = await repo.loadVault(a)
    const s = v2.subjects.find((x) => x.id === hist.id)!
    expect(s).toMatchObject({ name: 'История России', color: 'teal' })
    expect(v2.notes.filter((n) => n.subjectId === hist.id)).toHaveLength(1)
  })

  it('корзина: список с типами, восстановление предмета целиком, очистка старого', async () => {
    const { a, v } = await sample()
    const alg = v.subjects.find((s) => s.name === 'Алгоритмы')!
    await repo.trashEntry(a, v.pins.find((p) => p.subjectId === v.subjects[0].id)!.path)
    const trashed = await repo.trashEntry(a, alg.dir)
    expect((await repo.loadVault(a)).subjects.some((s) => s.id === alg.id)).toBe(false)

    const items = await repo.listTrash(a)
    expect(items.map((i) => i.kind).sort()).toEqual(['pin', 'subject'])
    const subj = items.find((i) => i.kind === 'subject')!
    expect(subj).toMatchObject({ name: 'Алгоритмы', originalPath: 'Алгоритмы' })
    expect(Date.now() - new Date(subj.deletedAt).getTime()).toBeLessThan(10_000)

    await repo.restoreFromTrash(a, trashed, subj.originalPath)
    const v3 = await repo.loadVault(a)
    expect(v3.subjects.find((s) => s.id === alg.id)?.name).toBe('Алгоритмы')
    expect(v3.notes.filter((n) => n.subjectId === alg.id)).toHaveLength(1)

    await repo.purgeTrash(a, -1)
    expect(await repo.listTrash(a)).toEqual([])
  })


  it('конспект по шаблону получает имя из заголовка', async () => {
    const { a, v } = await sample()
    const n = await repo.createNote(a, v.subjects[1], '# Лекция 10 октября\n\n**Тема:** ')
    expect(n.path).toBe('Физика/Конспекты/Лекция 10 октября.md')
    expect(n.title).toBe('Лекция 10 октября')
  })
})

describe('копия хранилища', () => {
  it('с заменой — файлы с теми же путями перезаписываются, лишние в папке остаются, корзина не копируется', async () => {
    const { a } = await sample()
    const folder = sampleVault()
    const note = 'Физика/Конспекты/Кинематика точки.md'
    await folder.writeText(note, '# старая версия')
    await folder.writeText('Своё/заметка.md', '# только в папке')
    await a.writeText('.studynotes/trash/x/старьё.md', '# в корзине')
    const copied = await repo.copyVault(a, folder, '', { overwrite: true })
    expect(copied).toBeGreaterThan(0)
    expect(await folder.readText(note)).toBe(await a.readText(note))
    expect(await folder.readText('Своё/заметка.md')).toBe('# только в папке')
    expect(await folder.exists('.studynotes/trash/x/старьё.md')).toBe(false)
  })

  it('без замены — существующие файлы не трогаются', async () => {
    const { a } = await sample()
    const folder = sampleVault()
    await folder.writeText('Физика/Конспекты/Кинематика точки.md', '# моя версия')
    await repo.copyVault(a, folder)
    expect(await folder.readText('Физика/Конспекты/Кинематика точки.md')).toBe('# моя версия')
  })
})
