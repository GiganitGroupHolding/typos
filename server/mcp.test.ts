// @vitest-environment node
// MCP-сервер работает в Node: без DOMParser и без браузера — проверяем там же
import 'fake-indexeddb/auto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DavAdapter } from '@/storage/davAdapter'
import { SyncedAdapter } from '@/storage/syncedAdapter'
import * as repo from '@/vault/repo'
import { NodeFsAdapter } from '../mcp/nodeAdapter'
import { openVault } from '../mcp/open'
import { StudyVault } from '../mcp/vault'
import { buildLink, DEFAULT_DEVICE, deviceKey, startServer, STATE_DIR } from './typos-server.mjs'

let dir: string
let srv: Awaited<ReturnType<typeof startServer>>
let link: string
/** Ключ «телефона» — устройства с локальной копией. */
let phoneToken: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'typos-mcp-'))
  // ключи заводим до запуска: работающий сервер перечитывает их не чаще раза в секунду
  const { token } = await deviceKey(dir, 'mcp')
  phoneToken = (await deviceKey(dir, 'phone')).token
  srv = await startServer({ dir, port: 0, host: '127.0.0.1', name: 'Дом' })
  link = buildLink({ base: `http://127.0.0.1:${srv.port}`, token, name: 'Дом', vaultId: srv.state.vaultId })
})

afterEach(async () => {
  await srv.close()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('MCP с сервером хранения (--link)', () => {
  it('пишет конспекты на сервер, и устройства их получают', async () => {
    const v = new StudyVault(await openVault(['--link', link], {}))
    await v.createSubject({ name: 'Физика' })
    const note = await v.createNote({ subject: 'Физика', title: 'Кинематика', markdown: 'скорость $v = s/t$' })
    expect(await fs.readFile(path.join(dir, note.path), 'utf8')).toContain('$v = s/t$')
    expect((await v.search({ query: 'скорость' })).map((h) => h.title)).toEqual(['Кинематика'])
    expect((await v.listSubjects()).map((s) => s.name)).toEqual(['Физика'])

    const device = new SyncedAdapter(
      { url: `http://127.0.0.1:${srv.port}`, token: phoneToken, name: 'Дом', vaultId: srv.state.vaultId },
      'mcp',
    )
    await device.initialSync()
    expect((await repo.loadVault(device)).notes.map((n) => n.title)).toEqual(['Кинематика'])

    await v.trash({ kind: 'note', id: note.id })
    expect(await repo.listTrash(new DavAdapter(device.config))).toHaveLength(1)
  })

  it('предупреждает, если MCP подключён общим ключом default, а не своим', async () => {
    const warnings: string[] = []
    await openVault(['--link', link], {}, (line) => warnings.push(line))
    expect(warnings).toEqual([])
    const shared = (await deviceKey(dir, DEFAULT_DEVICE)).token
    await new Promise((r) => setTimeout(r, 1100))
    await openVault(['--link', link.replace(/k=[^&]+/, `k=${shared}`)], {}, (line) => warnings.push(line))
    expect(warnings.join()).toMatch(/link mcp/)
  })

  it('имена с & и апострофом переживают список WebDAV', async () => {
    const a = (await openVault(['--link', link], {})) as DavAdapter
    await a.writeText("Tom & Jerry's/x.md", '# x')
    expect(await a.list('')).toEqual([{ name: "Tom & Jerry's", kind: 'dir' }])
  })

  it('ссылку берёт и из STUDYNOTES_LINK; --vault и --link вместе — ошибка', async () => {
    expect(await openVault([], { STUDYNOTES_LINK: link })).toBeInstanceOf(DavAdapter)
    await expect(openVault(['--vault', dir, '--link', link], {})).rejects.toThrow(/что-то одно/)
  })

  it('чужое хранилище и неверный ключ — ошибка при запуске', async () => {
    await expect(openVault(['--link', link.replace(/id=[^&]+/, 'id=other')], {})).rejects.toThrow(/другого хранилища/)
    await expect(openVault(['--link', link.replace(/k=[^&]+/, 'k=wrong')], {})).rejects.toMatchObject({ status: 401 })
  })

  it('сервер выключен — запускается, инструменты отвечают понятной ошибкой', async () => {
    await srv.close()
    const warnings: string[] = []
    const v = new StudyVault(await openVault(['--link', link], {}, (line) => warnings.push(line)))
    expect(warnings.join()).toMatch(/недоступен/)
    await expect(v.listSubjects()).rejects.toThrow(/не отвечает/)
    srv = await startServer({ dir, port: 0, host: '127.0.0.1' })
  })
})

describe('MCP с папкой сервера (--vault)', () => {
  it('не трогает ключи сервера хранения', async () => {
    const a = new NodeFsAdapter(dir)
    for (const p of [`${STATE_DIR}/server.json`, '.TYPOS-SERVER/server.json', '.typos-server./server.json']) {
      await expect(a.readText(p)).rejects.toThrow(/Недопустимый путь/)
    }
    expect((await a.list('')).map((e) => e.name)).not.toContain(STATE_DIR)
  })
})
