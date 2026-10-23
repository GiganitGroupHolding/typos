// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadVault } from '@/vault/repo'
import { LocalFiles } from './localFiles'
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

  it('не выпускает за корень по ссылке или junction и не пускает к ключам сервера через «./»', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'studynotes-outside-'))
    try {
      writeFileSync(path.join(outside, 'marker.txt'), 'снаружи')
      symlinkSync(outside, path.join(dir, 'jump'), 'junction')
      symlinkSync(path.join(outside, 'нет.txt'), path.join(dir, 'битая.txt'))
      mkdirSync(path.join(dir, '.typos-server'))
      writeFileSync(path.join(dir, '.typos-server', 'server.json'), '{}')
      symlinkSync(path.join(dir, '.typos-server'), path.join(dir, 'ключи'), 'junction')

      await expect(a.readText('jump/marker.txt')).rejects.toThrow(/вне хранилища/)
      await expect(a.writeText('jump/new.md', 'x')).rejects.toThrow(/вне хранилища/)
      await expect(a.writeText('битая.txt', 'x')).rejects.toThrow(/вне хранилища/)
      await expect(a.readText('./.typos-server/server.json')).rejects.toThrow(/Недопустимый путь/)
      await expect(a.readText('ключи/server.json')).rejects.toThrow(/вне хранилища/)
      expect(await a.exists('jump/marker.txt')).toBe(false)
      expect((await a.list('')).map((e) => e.name)).toEqual([])
      expect(readdirSync(outside)).toEqual(['marker.txt'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('ссылка на папку внутри vault работает как папка', async () => {
    await a.writeText('Физика/x.md', 'внутри')
    symlinkSync(path.join(dir, 'Физика'), path.join(dir, 'Ярлык'), 'junction')
    expect(await a.readText('Ярлык/x.md')).toBe('внутри')
    expect(await a.list('')).toEqual(expect.arrayContaining([{ name: 'Ярлык', kind: 'dir' }]))
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
  it('локальная картинка из разрешённой папки → webp в assets, ссылка для Markdown', async () => {
    const files = mkdtempSync(path.join(tmpdir(), 'studynotes-files-'))
    v = new StudyVault(a, { files: new LocalFiles([files]) })
    await v.createSubject({ name: 'Химия' })
    const png = path.join(files, 'pic.png')
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
      await expect(new StudyVault(a).addImage({ subject: 'Химия', source: png })).rejects.toThrow(/выключено/)
    } finally {
      rmSync(files, { recursive: true, force: true })
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

describe('доски', () => {
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

  it('создаёт доску: узлы без координат расставлены схемой, рамка встаёт вокруг своих', async () => {
    await v.createSubject({ name: 'Физика' })
    const r = await v.createBoard({
      subject: 'Физика',
      name: 'Законы Ньютона',
      nodes: [
        { id: 'root', text: '# Законы Ньютона', color: 'yellow' },
        { id: 'n1', text: 'Первый: инерция' },
        { id: 'n2', text: 'Второй: $\\vec F = m\\vec a$', color: '4' },
        { id: 'g', type: 'group', label: 'Следствия', children: ['n1', 'n2'] },
      ],
      edges: [
        { from: 'root', to: 'n1' },
        { from: 'root', to: 'n2', label: 'сила' },
      ],
    })
    expect(r.nodes).toEqual(['root', 'n1', 'n2', 'g'])
    expect(r.warnings).toEqual([])

    const b = await v.readBoard(r.id)
    expect(b).toMatchObject({ subject: 'Физика', name: 'Законы Ньютона', path: 'Физика/Доски/Законы Ньютона.canvas' })
    const by = new Map(b.nodes.map((n) => [n.id, n]))
    expect(by.get('root')).toMatchObject({ color: '3', type: 'text' })
    expect(overlap(by.get('root')!, by.get('n1')!)).toBe(false)
    expect(overlap(by.get('n1')!, by.get('n2')!)).toBe(false)
    const g = by.get('g')!
    for (const id of ['n1', 'n2']) {
      const n = by.get(id)!
      expect(n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).toBe(true)
    }
    expect(b.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['root', 'n1', undefined],
      ['root', 'n2', 'сила'],
    ])
    // файл читается приложением
    expect((await loadVault(a)).boards[0].data.nodes).toHaveLength(4)
  })

  it('правит, добавляет под существующим, удаляет и переименовывает', async () => {
    await v.createSubject({ name: 'Физика' })
    const { id } = await v.createBoard({ subject: 'Физика', name: 'Схема', nodes: [{ id: 'a', text: 'А', x: 0, y: 0 }] })
    const r = await v.updateBoard({
      id,
      name: 'Схема темы',
      nodes: [
        { id: 'a', text: 'А\nвторая строка\nтретья\nчетвёртая' },
        { id: 'b', text: 'Б' },
      ],
      edges: [{ id: 'e', from: 'a', to: 'b', arrow: 'both' }],
    })
    expect(r).toMatchObject({ name: 'Схема темы', path: 'Физика/Доски/Схема темы.canvas', nodes: ['a', 'b'] })
    let b = await v.readBoard(id)
    const [na, nb] = b.nodes
    expect(na).toMatchObject({ x: 0, y: 0, text: 'А\nвторая строка\nтретья\nчетвёртая' })
    expect(na.height).toBeGreaterThan(80)
    expect(nb.y).toBeGreaterThanOrEqual(na.y + na.height)
    expect(b.edges[0]).toMatchObject({ id: 'e', arrow: 'both' })

    await v.updateBoard({ id, edges: [{ id: 'e', label: 'связь', arrow: 'end' }] })
    expect((await v.readBoard(id)).edges[0]).toEqual({ id: 'e', from: 'a', to: 'b', label: 'связь' })

    await v.updateBoard({ id, remove: ['b'] })
    b = await v.readBoard(id)
    expect(b.nodes.map((n) => n.id)).toEqual(['a'])
    expect(b.edges).toEqual([])
  })

  it('отказывает в чужих путях, плохих ссылках и стрелках в никуда', async () => {
    await v.createSubject({ name: 'Физика' })
    const { id } = await v.createBoard({ subject: 'Физика', name: 'Схема' })
    await expect(v.updateBoard({ id, nodes: [{ type: 'file', file: '../секрет.png' }] })).rejects.toThrow(/внутри хранилища/)
    await expect(v.updateBoard({ id, nodes: [{ type: 'file', file: '.typos-server/server.json' }] })).rejects.toThrow(/внутри хранилища/)
    await expect(v.updateBoard({ id, nodes: [{ type: 'link', url: 'javascript:alert(1)' }] })).rejects.toThrow(/http/)
    await expect(v.updateBoard({ id, nodes: [{ text: 'x', color: 'url(x)' }] })).rejects.toThrow(/цвет/)
    await expect(v.updateBoard({ id, edges: [{ from: 'нет', to: 'тоже' }] })).rejects.toThrow(/нет узла/)
    expect((await v.readBoard(id)).nodes).toEqual([])
  })

  it('поиск находит доску, корзина её принимает, формулы проверяются', async () => {
    await v.createSubject({ name: 'Физика' })
    const r = await v.createBoard({ subject: 'Физика', name: 'Энергия', nodes: [{ id: 'k', text: 'Кинетическая $\\frac{mv^2$' }] })
    expect(r.warnings[0]).toMatch(/^Узел k: /)
    expect((await v.search({ query: 'кинетическая' }))[0]).toMatchObject({ kind: 'board', id: r.id })
    expect((await v.getSubject('Физика')).boards).toEqual([{ id: r.id, name: 'Энергия', nodes: 1, edges: 0 }])
    await v.trash({ kind: 'board', id: r.id })
    expect((await v.listSubjects())[0].boards).toBe(0)
  })
})
