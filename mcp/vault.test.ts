// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadVault } from '@/vault/repo'
import { NodeFsAdapter } from './nodeAdapter'
import { checkMarkdown, composeBody, replaceSection, StudyVault } from './vault'

let dir: string
let a: NodeFsAdapter
let v: StudyVault

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'studynotes-mcp-'))
  a = new NodeFsAdapter(dir)
  v = new StudyVault(a)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('адаптер', () => {
  it('не выпускает за корень хранилища', async () => {
    await expect(a.readText('../секрет.txt')).rejects.toThrow(/Недопустимый путь/)
    await expect(a.writeText('Физика/../../x.md', '')).rejects.toThrow(/Недопустимый путь/)
    await expect(a.readText('C:/Windows/win.ini')).rejects.toThrow(/Недопустимый путь/)
  })
})

describe('конспекты', () => {
  it('создание: файл как у приложения, формулы приведены, заголовок из title', async () => {
    await v.createSubject({ name: 'Математика', icon: 'sigma' })
    const r = await v.createNote({ subject: 'математика', title: 'Матрицы', markdown: 'Определитель \\(\\det A\\):\n\n\\[\nad - bc\n\\]' })
    expect(r).toMatchObject({ action: 'created', path: 'Математика/Конспекты/Матрицы.md', warnings: [] })
    const note = (await loadVault(a)).notes[0]
    expect(note.body).toBe('# Матрицы\n\nОпределитель $\\det A$:\n\n$$\nad - bc\n$$\n')
    expect(note.created).toBe(note.updated)
  })

  it('повторный перенос с тем же source обновляет, а не плодит дубль', async () => {
    await v.createSubject({ name: 'Экономика' })
    const first = await v.createNote({ subject: 'Экономика', title: 'Лекция 1', markdown: 'старое', source: 'doc:42' })
    const again = await v.createNote({ subject: 'Экономика', title: 'Лекция 1', markdown: 'новое', source: 'doc:42' })
    expect(again).toMatchObject({ id: first.id, action: 'updated' })
    const d = await loadVault(a)
    expect(d.notes).toHaveLength(1)
    expect(d.notes[0]).toMatchObject({ body: '# Лекция 1\n\nновое\n', meta: { source: 'doc:42' } })
  })

  it('update: append, replace_section, replace с переименованием файла', async () => {
    await v.createSubject({ name: 'Физика' })
    const { id } = await v.createNote({
      subject: 'Физика',
      title: 'Кинематика',
      markdown: '## Скорость\n\n$v = s/t$\n\n## Ускорение\n\nстарое',
    })
    await v.updateNote({ id, mode: 'append', markdown: '## Итог\n\nвсё' })
    await v.updateNote({ id, mode: 'replace_section', section: 'ускорение', markdown: '$a = \\Delta v / t$' })
    let body = (await v.readNote(id)).markdown
    expect(body).toBe('# Кинематика\n\n## Скорость\n\n$v = s/t$\n\n## Ускорение\n\n$a = \\Delta v / t$\n\n## Итог\n\nвсё\n')
    const r = await v.updateNote({ id, mode: 'replace', markdown: '# Движение\n\nзаново' })
    expect(r.path).toBe('Физика/Конспекты/Движение.md')
    expect(await a.exists('Физика/Конспекты/Кинематика.md')).toBe(false)
    body = (await v.readNote(id)).markdown
    expect(body).toBe('# Движение\n\nзаново\n')
  })

  it('replace без заголовка сохраняет старый заголовок', () => {
    expect(composeBody('просто текст', 'Старый')).toBe('# Старый\n\nпросто текст\n')
    expect(() => composeBody('без заголовка')).toThrow(/Нужен заголовок/)
  })

  it('replace_section: неизвестный раздел — ошибка со списком заголовков', () => {
    expect(() => replaceSection('# A\n\n## Б\n\nx', 'В', 'y')).toThrow(/Заголовки: A \| Б/)
  })
})

describe('проверка разметки', () => {
  it('ловит сломанные формулы и непарный $', () => {
    const w = checkMarkdown('# T\n\nцена 100$ за штуку\n\n$\\frac{1}{$\n\n$$\n\\begin{pmatrix} 1 \n$$\n\n`$x` в коде — ок')
    expect(w.some((x) => x.includes('непарный'))).toBe(true)
    expect(w.some((x) => x.startsWith('Блок'))).toBe(true)
    expect(w.filter((x) => x.includes('Строка 7'))).toHaveLength(0)
  })

  it('чистый конспект — без предупреждений', () => {
    expect(checkMarkdown('# T\n\n$a^2$ и \\$5\n\n| $x$ | y |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst a = "$"\n```')).toEqual([])
  })
})

describe('картинки, закреп, тулзы, поиск, корзина', () => {
  it('локальная картинка → webp в assets, ссылка для Markdown', async () => {
    await v.createSubject({ name: 'Химия' })
    const png = path.join(dir, '..', `pic-${Date.now()}.png`)
    writeFileSync(
      png,
      await sharp({ create: { width: 40, height: 20, channels: 3, background: '#f00' } })
        .png()
        .toBuffer(),
    )
    try {
      const r = await v.addImage({ subject: 'Химия', source: png, alt: 'схема' })
      expect(r.markdown).toMatch(/^!\[схема\]\(assets\/[a-z0-9]+\.webp\)$/)
      expect(await a.exists(r.path)).toBe(true)
    } finally {
      rmSync(png, { force: true })
    }
  })

  it('data:-картинка в тексте конспекта скачивается в assets', async () => {
    await v.createSubject({ name: 'Химия' })
    const b64 = (
      await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } })
        .png()
        .toBuffer()
    ).toString('base64')
    const { id } = await v.createNote({ subject: 'Химия', title: 'Схема', markdown: `![](data:image/png;base64,${b64})` })
    expect((await v.readNote(id)).markdown).toMatch(/!\[\]\(assets\/[a-z0-9]+\.webp\)/)
  })

  it('карточки по порядку, правка карточки, тулза, поиск, корзина', async () => {
    await v.createSubject({ name: 'Математика' })
    const p1 = await v.createPin({ subject: 'Математика', title: 'Крамер', tex: 'x_i = \\frac{\\Delta_i}{\\Delta}', text: 'при Δ ≠ 0' })
    await v.createPin({ subject: 'Математика', title: 'Определитель', tex: 'ad - bc' })
    await v.updatePin({ id: p1.id, text: 'Δ ≠ 0, иначе Гаусс' })
    await v.importTool({
      subject: 'Математика',
      name: 'Калькулятор',
      html: '<html><head><title>К</title></head><body>1</body></html>',
      icon: 'grid',
    })
    const { id } = await v.createNote({ subject: 'Математика', title: 'Ёмкость', markdown: 'Метод Крамера для систем' })

    const s = await v.getSubject('Математика')
    expect(s.pins.map((p) => [p.title, p.order, p.text])).toEqual([
      ['Крамер', 0, 'Δ ≠ 0, иначе Гаусс'],
      ['Определитель', 1, undefined],
    ])
    expect(s.tools).toMatchObject([{ name: 'Калькулятор', kind: 'html', file: 'Калькулятор.html' }])
    const pdf = await v.addProjectFile({
      subject: 'Математика',
      fileName: 'C:\\Загрузки\\Лекция 5 матрицы.pdf',
      data: new Uint8Array([37, 80, 68, 70]),
    })
    expect(pdf).toMatchObject({ kind: 'pdf', path: 'Математика/Проекты/Лекция 5 матрицы.pdf' })

    const hits = await v.search({ query: 'крамер' })
    expect(hits.map((h) => h.kind).sort()).toEqual(['note', 'pin'])
    expect((await v.search({ query: 'емкость' }))[0]).toMatchObject({ id, kind: 'note' })

    const t = await v.trash({ kind: 'note', id })
    expect(t.trash).toMatch(/^\.studynotes\/trash\//)
    expect((await loadVault(a)).notes).toHaveLength(0)
  })
})
