// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

/** Сервер поднимается так же, как его запускает Claude: node + tsx, общение по stdio. */
function connect(client: Client, args: string[]) {
  return client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(root, 'node_modules/tsx/dist/cli.mjs'),
        '--tsconfig',
        path.join(root, 'mcp/tsconfig.json'),
        path.join(root, 'mcp/server.ts'),
        ...args,
      ],
    }),
  )
}

const text = (r: Record<string, unknown>) => (r.content as { text: string }[])[0].text

it('сервер отвечает по stdio', { timeout: 30_000 }, async () => {
  const vault = mkdtempSync(path.join(tmpdir(), 'studynotes-stdio-'))
  const files = mkdtempSync(path.join(tmpdir(), 'studynotes-files-'))
  const client = new Client({ name: 'test', version: '1.0.0' })
  try {
    await connect(client, ['--vault', vault, '--files', files])
    expect(client.getInstructions()).toMatch(/Формат конспекта/)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'add_image',
        'add_project_file',
        'create_note',
        'create_pin',
        'create_subject',
        'get_subject',
        'import_tool',
        'list_subjects',
        'read_note',
        'search',
        'trash',
        'update_note',
        'update_pin',
      ].sort(),
    )
    await client.callTool({ name: 'create_subject', arguments: { name: 'Тест' } })
    const created = await client.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Привет', markdown: '$x^2$' } })
    expect(JSON.parse(text(created))).toMatchObject({ action: 'created', warnings: [] })
    // большой текст — файлом из разрешённой папки, а не аргументом
    const md = path.join(files, 'lecture.md')
    writeFileSync(md, '# Лекция из файла\n\nТекст $a^2$\n')
    const fromFile = await client.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Лекция из файла', file: md } })
    expect(JSON.parse(text(fromFile))).toMatchObject({ action: 'created', warnings: [] })
    // файл вне разрешённой папки, скрытый файл и ссылка наружу — нет
    const secret = path.join(vault, '..', `secret-${Date.now()}.md`)
    writeFileSync(secret, '# Секрет\n')
    mkdirSync(path.join(files, '.ssh'))
    writeFileSync(path.join(files, '.ssh', 'id.md'), '# Ключ\n')
    symlinkSync(secret, path.join(files, 'ярлык.md'))
    try {
      for (const [file, error] of [
        [secret, /вне разрешённых папок/],
        [path.join(files, '.ssh', 'id.md'), /Скрытые файлы/],
        [path.join(files, 'ярлык.md'), /вне разрешённых папок/],
      ] as const) {
        const r = await client.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Утечка', file } })
        expect(r.isError).toBe(true)
        expect(text(r)).toMatch(error)
        const p = await client.callTool({ name: 'add_project_file', arguments: { subject: 'Тест', file } })
        expect(text(p)).toMatch(error)
      }
    } finally {
      rmSync(secret, { force: true })
    }
    const none = await client.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Пусто' } })
    expect(text(none)).toMatch(/Нужен markdown или file/)
    const bad = await client.callTool({ name: 'get_subject', arguments: { subject: 'Нет такого' } })
    expect(bad.isError).toBe(true)
    expect(text(bad)).toMatch(/Есть: Тест/)
  } finally {
    await client.close()
    rmSync(vault, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  }
})

it('без --files не читает файлы компьютера и не открывает локальную сеть', { timeout: 30_000 }, async () => {
  const vault = mkdtempSync(path.join(tmpdir(), 'studynotes-stdio-'))
  const client = new Client({ name: 'test', version: '1.0.0' })
  try {
    await connect(client, ['--vault', vault])
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).not.toContain('add_project_file')
    expect(JSON.stringify(tools.find((t) => t.name === 'create_note')?.inputSchema)).not.toContain('"file"')
    await client.callTool({ name: 'create_subject', arguments: { name: 'Тест' } })
    const image = path.join(vault, '..', `pic-${Date.now()}.png`)
    writeFileSync(image, 'x')
    try {
      const local = await client.callTool({ name: 'add_image', arguments: { subject: 'Тест', source: image } })
      expect(text(local)).toMatch(/Чтение файлов с компьютера выключено/)
    } finally {
      rmSync(image, { force: true })
    }
    const lan = await client.callTool({ name: 'add_image', arguments: { subject: 'Тест', source: 'http://127.0.0.1:9/x.png' } })
    expect(text(lan)).toMatch(/локальную сеть/)
  } finally {
    await client.close()
    rmSync(vault, { recursive: true, force: true })
  }
})
