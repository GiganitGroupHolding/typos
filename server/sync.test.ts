import 'fake-indexeddb/auto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { monitorConnection, useConnection } from '@/storage/connection'
import { DavAdapter } from '@/storage/davAdapter'
import { conflictCopy, fromBlob } from '@/storage/sync'
import { SyncedAdapter } from '@/storage/syncedAdapter'
import { sampleVault } from '@/test/sampleVault'
import { parseFrontmatter } from '@/vault/format'
import * as repo from '@/vault/repo'
import { useVault } from '@/vault/store'
import { deviceKey, startServer } from './typos-server.mjs'

let dir: string
let srv: Awaited<ReturnType<typeof startServer>>
let port: number
let token: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'typos-sync-'))
  srv = await startServer({ dir, port: 0, host: '127.0.0.1', name: 'Тест' })
  port = srv.port
  token = (await deviceKey(dir)).token
})

afterEach(async () => {
  await srv.close()
  await fs.rm(dir, { recursive: true, force: true })
})

const config = () => ({ url: `http://127.0.0.1:${port}`, token, name: 'Тест', vaultId: srv.state.vaultId })
const direct = () => new DavAdapter(config())
/** Устройство со своей локальной копией (scope — отдельная база IndexedDB). */
async function device(scope: string) {
  const d = new SyncedAdapter(config(), scope)
  await d.initialSync()
  return d
}
const onServer = (p: string) => fs.readFile(path.join(dir, p), 'utf8').catch(() => null)
const restart = async () => {
  srv = await startServer({ dir, port, host: '127.0.0.1' })
}

/** Предмет с одним конспектом прямо на сервере. */
async function seed() {
  const subject = await repo.createSubject(direct(), { name: 'Физика', color: 'blue', icon: 'atom' }, 0)
  const note = await repo.createNote(direct(), subject, '# Кинематика\n\nскорость')
  return { subject, note }
}

describe('синхронизация с локальной копией', () => {
  it('первая синхронизация забирает всё, дальше копия открывается без сети', async () => {
    await seed()
    const a = await device('a')
    expect((await repo.loadVault(a)).notes.map((n) => n.title)).toEqual(['Кинематика'])
    await srv.close()
    const reopened = new SyncedAdapter(config(), 'a')
    expect(await reopened.isReady()).toBe(true)
    expect((await repo.loadVault(reopened)).notes.map((n) => n.title)).toEqual(['Кинематика'])
    await restart()
  })

  it('правка пишется локально и уходит на сервер', async () => {
    const { subject } = await seed()
    const a = await device('a')
    const note = await repo.createNote(a, subject, '# Динамика')
    expect(await a.engine.countPending()).toBe(1)
    await a.engine.syncNow()
    expect(await onServer(note.path)).toContain('# Динамика')
    expect(await a.engine.countPending()).toBe(0)
  })

  it('без связи правки копятся, переживают перезагрузку и уходят после переподключения', async () => {
    const { subject } = await seed()
    const a = await device('a')
    await srv.close()
    const note = await repo.createNote(a, subject, '# Офлайн')
    await expect(a.engine.syncNow()).rejects.toThrow(/не отвечает/)
    // «перезагрузили страницу»: новая копия того же хранилища помнит неотправленное
    const reloaded = new SyncedAdapter(config(), 'a')
    expect(await reloaded.engine.countPending()).toBe(1)
    await restart()
    await reloaded.engine.syncNow()
    expect(await onServer(note.path)).toContain('# Офлайн')
    expect(await reloaded.engine.countPending()).toBe(0)
  })

  it('изменения с другого устройства приходят и перечитываются', async () => {
    const { note } = await seed()
    const [a, b] = [await device('a'), await device('b')]
    let changed = 0
    a.onChanged = () => changed++
    await repo.saveNote(b, note, '# Кинематика\n\nдописал на телефоне')
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(await repo.readNoteBody(a, note.path)).toContain('дописал на телефоне')
    expect(changed).toBeGreaterThan(0)
  })

  it('правили с обеих сторон — обе версии сохранены, это разные конспекты', async () => {
    const { note } = await seed()
    const [a, b] = [await device('a'), await device('b')]
    const conflicts: string[] = []
    a.engine.hooks.onConflict = (_p, copy) => conflicts.push(copy)
    await repo.saveNote(a, note, '# Кинематика\n\nверсия ноутбука')
    await repo.saveNote(b, note, '# Кинематика\n\nверсия телефона')
    await b.engine.syncNow()
    await a.engine.syncNow()
    await b.engine.syncNow()

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatch(/Кинематика \(конфликт \d\d\.\d\d \d\d-\d\d\)\.md$/)
    expect(await onServer(note.path)).toContain('версия телефона')
    expect(await onServer(conflicts[0])).toContain('версия ноутбука')
    for (const d of [a, b]) {
      const notes = (await repo.loadVault(d)).notes
      expect(notes).toHaveLength(2)
      expect(new Set(notes.map((n) => n.id)).size).toBe(2)
    }
  })

  it('одинаковая правка с обеих сторон — не конфликт', async () => {
    const { note } = await seed()
    const [a, b] = [await device('a'), await device('b')]
    await repo.saveNote(a, note, '# Кинематика\n\nодно и то же')
    const text = await a.readText(note.path)
    await b.writeText(note.path, text!)
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect((await repo.loadVault(a)).notes).toHaveLength(1)
    expect(await a.engine.countPending()).toBe(0)
  })

  it('удалили на одном, правили на другом — правка важнее', async () => {
    const { note } = await seed()
    const [a, b] = [await device('a'), await device('b')]
    await repo.trashNote(a, note)
    await repo.saveNote(b, note, '# Кинематика\n\nважная правка')
    await a.engine.syncNow()
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(await onServer(note.path)).toContain('важная правка')
    expect(await repo.readNoteBody(a, note.path)).toContain('важная правка')
  })

  it('предмет ушёл в корзину — опустевшая папка исчезает и на сервере', async () => {
    const { subject } = await seed()
    const a = await device('a')
    await repo.trashEntry(a, subject.dir)
    await a.engine.syncNow()
    await expect(fs.stat(path.join(dir, subject.dir))).rejects.toThrow()
    expect((await repo.listTrash(direct())).map((t) => t.name)).toContain('Физика')
  })

  it('две вкладки с одной копией не плодят ложных конфликтов', async () => {
    const { note } = await seed()
    await device('tabs')
    const [t1, t2] = [new SyncedAdapter(config(), 'tabs'), new SyncedAdapter(config(), 'tabs')]
    await repo.saveNote(t1, note, '# Кинематика\n\nиз первой вкладки')
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()])
    await repo.saveNote(t2, note, '# Кинематика\n\nиз второй вкладки')
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()])
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()])
    expect(await onServer(note.path)).toContain('из второй вкладки')
    expect((await repo.loadVault(direct())).notes).toHaveLength(1)
    expect(await t1.engine.countPending()).toBe(0)
  })

  it('правку прямо в папке на сервере устройства видят сразу', async () => {
    const { note } = await seed()
    const a = await device('a')
    let events = 0
    const stop = monitorConnection(a.remote, { onServerChange: () => events++ })
    try {
      const until = Date.now() + 3000
      while (useConnection.getState().status !== 'online' && Date.now() < until) await new Promise((r) => setTimeout(r, 10))
      const text = (await onServer(note.path))!.replace('скорость', 'правка в Obsidian на сервере')
      await fs.writeFile(path.join(dir, note.path), text)
      while (!events && Date.now() < until) await new Promise((r) => setTimeout(r, 10))
      expect(events).toBeGreaterThan(0)
      await a.engine.syncNow()
      expect(await repo.readNoteBody(a, note.path)).toContain('правка в Obsidian на сервере')
    } finally {
      stop()
    }
  })
})

describe('текстовые файлы в локальной копии', () => {
  const bytes = async (v: string | Blob) => new Uint8Array(await new Blob([v]).arrayBuffer())

  it('строка обратно в байты даёт ровно те же байты: BOM не теряется, не-UTF-8 остаётся Blob', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x41])
    const value = await fromBlob('a.txt', new Blob([bom]))
    expect(typeof value).toBe('string')
    expect(await bytes(value)).toEqual(bom)

    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8])
    const raw = await fromBlob('b.txt', new Blob([cp1251]))
    expect(raw).toBeInstanceOf(Blob)
    expect(await bytes(raw)).toEqual(cp1251)
  })
})

describe('копия при конфликте', () => {
  it('новый id и пометка в заголовке, имя не занято', () => {
    const text = '---\nid: abc123\ncreated: x\n---\n\n# Кинематика\n\nтекст'
    const when = new Date(2026, 9, 18, 14, 5)
    const taken = new Set(['Физика/Конспекты/Кинематика (конфликт 18.10 14-05).md'])
    const copy = conflictCopy('Физика/Конспекты/Кинематика.md', text, taken, when)
    expect(copy.path).toBe('Физика/Конспекты/Кинематика (конфликт 18.10 14-05, 2).md')
    const { meta, body } = parseFrontmatter(copy.value as string)
    expect(meta.id).not.toBe('abc123')
    expect(body).toMatch(/^# Кинематика \(конфликт 18\.10 14-05\)/)
  })
})

describe('подключение сервера', () => {
  it('открыта папка — её конспекты переносятся на сервер, в папке ничего не меняется', async () => {
    const folder = sampleVault()
    const before = await repo.loadVault(folder)
    useVault.setState({ ...before, adapter: folder, status: 'ready' })
    const { copied } = await useVault.getState().connectRemote(config(), true)
    expect(copied).toBeGreaterThan(0)
    const server = await repo.loadVault(direct())
    expect(server.notes.map((n) => n.title).sort()).toEqual(before.notes.map((n) => n.title).sort())
    expect((await repo.loadVault(folder)).notes).toHaveLength(before.notes.length)
  })
})
