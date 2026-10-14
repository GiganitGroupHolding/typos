import { describe, expect, it } from 'vitest'
import * as repo from './repo'
import { sampleVault } from '@/test/sampleVault'

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
    expect(loaded).toMatchObject({ name: 'Решатель СЛАУ', icon: 'grid', path: 'Линейная алгебра/Инструменты/Решатель СЛАУ.html' })
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
