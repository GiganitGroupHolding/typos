// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, it } from 'vitest'

/** Сервер поднимается так же, как его запускает Claude: node + tsx, общение по stdio. */
it('сервер отвечает по stdio', { timeout: 30_000 }, async () => {
  const vault = mkdtempSync(path.join(tmpdir(), 'studynotes-stdio-'))
  const root = path.resolve(import.meta.dirname, '..')
  const client = new Client({ name: 'test', version: '1.0.0' })
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', path.join(root, 'mcp/tsconfig.json'), path.join(root, 'mcp/server.ts'), '--vault', vault],
      }),
    )
    expect(client.getInstructions()).toMatch(/Формат конспекта/)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['add_image', 'add_project_file', 'create_note', 'create_pin', 'create_subject', 'get_subject', 'import_tool', 'list_subjects', 'read_note', 'search', 'trash', 'update_note', 'update_pin'].sort(),
    )
    await client.callTool({ name: 'create_subject', arguments: { name: 'Тест' } })
    const created = await client.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Привет', markdown: '$x^2$' } })
    expect(JSON.parse((created.content as { text: string }[])[0].text)).toMatchObject({ action: 'created', warnings: [] })
    // большой текст — файлом, а не аргументом
    const md = path.join(vault, '..', `lecture-${Date.now()}.md`)
    writeFileSync(md, '# Лекция из файла\n\nТекст $a^2$\n')
    try {
      const fromFile = await client.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Лекция из файла', file: md } })
      expect(JSON.parse((fromFile.content as { text: string }[])[0].text)).toMatchObject({ action: 'created', warnings: [] })
    } finally {
      rmSync(md, { force: true })
    }
    const none = await client.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Пусто' } })
    expect((none.content as { text: string }[])[0].text).toMatch(/Нужен markdown или file/)
    const bad = await client.callTool({ name: 'get_subject', arguments: { subject: 'Нет такого' } })
    expect(bad.isError).toBe(true)
    expect((bad.content as { text: string }[])[0].text).toMatch(/Есть: Тест/)
  } finally {
    await client.close()
    rmSync(vault, { recursive: true, force: true })
  }
})
