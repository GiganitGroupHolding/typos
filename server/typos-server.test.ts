import 'fake-indexeddb/auto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBrowserAdapter } from '@/storage/browserAdapter'
import { monitorConnection, useConnection, type ConnectionStatus } from '@/storage/connection'
import { DavAdapter } from '@/storage/davAdapter'
import { RemoteAdapter } from '@/storage/remoteAdapter'
import { parseRemoteLink } from '@/storage/remoteLink'
import type { SyncedAdapter } from '@/storage/syncedAdapter'
import type { VaultAdapter } from '@/storage/VaultAdapter'
import * as repo from '@/vault/repo'
import { useVault } from '@/vault/store'
import { buildLink, connectionTargets, deviceKey, revokeDevice, rotateDevice, startServer, STATE_DIR } from './typos-server.mjs'

let dir: string
let srv: Awaited<ReturnType<typeof startServer>>
let base: string
let token: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'typos-server-'))
  srv = await startServer({ dir, port: 0, host: '127.0.0.1', name: 'Тест' })
  base = `http://127.0.0.1:${srv.port}`
  token = (await deviceKey(dir, 'laptop')).token
})

afterEach(async () => {
  await srv.close()
  await fs.rm(dir, { recursive: true, force: true })
})

const adapter = () => new DavAdapter({ url: base, token, name: 'Тест', vaultId: srv.state.vaultId })
const call = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(base + p, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } })

/** Путь как есть: fetch сам схлопнул бы «%2e%2e» и до сервера бы не дошло. */
const rawStatus = (p: string) =>
  new Promise<number>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: srv.port, path: p, headers: { Authorization: `Bearer ${token}` } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      .on('error', reject)
  })

describe('ссылка подключения', () => {
  it('сервер собирает, приложение разбирает', () => {
    const link = buildLink({ base: 'https://notes.example.com:8443/typos/', token: 'abc', name: 'Дом', vaultId: 'v1' })
    expect(link).toMatch(/^typos:\/\/notes\.example\.com:8443\/typos\?/)
    expect(parseRemoteLink(link)).toEqual({ url: 'https://notes.example.com:8443/typos', token: 'abc', name: 'Дом', vaultId: 'v1' })
    expect(parseRemoteLink(`  ${buildLink({ base: 'http://192.168.1.10:8787', token: 't', name: 'x', vaultId: 'v' })}\n`).url).toBe(
      'http://192.168.1.10:8787',
    )
  })

  it('ссылку можно показать снова, rotate выдаёт новую', async () => {
    expect((await deviceKey(dir, 'laptop')).token).toBe(token)
    const { token: fresh } = await rotateDevice(dir, 'laptop')
    expect(fresh).not.toBe(token)
    expect((await deviceKey(dir, 'laptop')).token).toBe(fresh)
  })

  it('подписывает адреса: localhost всегда первым', () => {
    const all = connectionTargets({ port: 8787, host: '0.0.0.0', tls: false })
    expect(all[0]).toEqual({ label: expect.stringMatching(/этом же компьютере/), base: 'http://localhost:8787' })
    expect(connectionTargets({ port: 8787, host: '127.0.0.1', tls: true })).toEqual([
      { label: expect.stringMatching(/localhost/), base: 'https://localhost:8787' },
    ])
    expect(connectionTargets({ port: 8787, host: '192.168.1.10', tls: false })[0].label).toMatch(/локальной сети/)
    expect(connectionTargets({ port: 8787, host: '0.0.0.0', tls: false, publicUrl: 'https://notes.example.com' })).toHaveLength(1)
  })

  it('отклоняет чужие и неполные ссылки', () => {
    expect(() => parseRemoteLink('https://example.com')).toThrow(/typos:\/\//)
    expect(() => parseRemoteLink('typos://192.168.1.10:8787')).toThrow(/ключа/)
  })
})

describe('сервер хранения', () => {
  it('отвечает на info и пускает только с ключом', async () => {
    const info = await adapter().info()
    expect(info).toMatchObject({ protocol: 'typos-storage/1', name: 'Тест', device: 'laptop', vaultId: srv.state.vaultId })
    expect((await fetch(`${base}/.typos/info`)).status).toBe(401)
    expect((await call('/.typos/info', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401)
    // файловому менеджеру — Basic с ключом вместо пароля
    const basic = Buffer.from(`any:${token}`).toString('base64')
    expect((await call('/.typos/info', { headers: { Authorization: `Basic ${basic}` } })).status).toBe(200)
  })

  it('отозванный ключ перестаёт работать без перезапуска', async () => {
    expect(await revokeDevice(dir, 'laptop')).toBe(true)
    await new Promise((r) => setTimeout(r, 1100))
    await expect(adapter().info()).rejects.toMatchObject({ status: 401 })
  })

  it('repo работает через сервер так же, как с папкой', async () => {
    const a = adapter()
    const subject = await repo.createSubject(a, { name: 'Физика', color: 'blue', icon: 'atom' }, 0)
    const note = await repo.createNote(a, subject, '# Кинематика\n\n$v = s/t$')
    await repo.saveAsset(a, 'Физика/Конспекты', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }))

    const data = await repo.loadVault(a)
    expect(data.subjects.map((s) => s.name)).toEqual(['Физика'])
    expect(data.notes.map((n) => n.title)).toEqual(['Кинематика'])
    expect(await fs.readFile(path.join(dir, note.path), 'utf8')).toContain('$v = s/t$')

    await repo.trashNote(a, data.notes[0])
    expect((await repo.loadVault(a)).notes).toEqual([])
    expect((await repo.listTrash(a)).map((t) => t.name)).toContain('Кинематика')
  })

  it('перемещение не затирает существующее', async () => {
    const a = adapter()
    await a.writeText('A/x.md', '1')
    await a.writeText('A/y.md', '2')
    await expect(a.move('A/x.md', 'A/y.md')).rejects.toThrow(/Уже существует/)
    await a.move('A', 'B/C')
    expect(await a.list('B/C')).toEqual(
      expect.arrayContaining([
        { name: 'x.md', kind: 'file' },
        { name: 'y.md', kind: 'file' },
      ]),
    )
    expect(await a.exists('A')).toBe(false)
    expect(await a.list('B')).toEqual([{ name: 'C', kind: 'dir' }])
  })

  it('If-Match не даёт перезаписать чужую правку', async () => {
    const put = await call('/files/n.md', { method: 'PUT', body: 'v1', headers: { 'If-None-Match': '*' } })
    expect(put.status).toBe(201)
    const etag = put.headers.get('etag')!
    expect((await call('/files/n.md', { method: 'PUT', body: 'again', headers: { 'If-None-Match': '*' } })).status).toBe(412)
    expect((await call('/files/n.md', { method: 'PUT', body: 'v2', headers: { 'If-Match': etag } })).status).toBe(204)
    expect((await call('/files/n.md', { method: 'PUT', body: 'v3', headers: { 'If-Match': etag } })).status).toBe(412)
    expect(await (await call('/files/n.md')).text()).toBe('v2')
    const manifest = await (await call('/.typos/manifest')).json()
    expect(manifest.files['n.md'].etag).not.toBe(etag)
  })

  it('не выпускает за корень и прячет служебную папку', async () => {
    await fs.writeFile(path.join(path.dirname(dir), 'secret.txt'), 'x').catch(() => {})
    // «%2e%2e» и «..» URL схлопывает до разбора — запрос уходит мимо /files/
    expect(await rawStatus('/files/%2e%2e/secret.txt')).toBe(404)
    expect(await rawStatus('/files/../../secret.txt')).toBe(404)
    expect(await rawStatus('/files/..%2fsecret.txt')).toBe(400)
    expect(await rawStatus('/files/a%5c..%5csecret.txt')).toBe(400)
    expect((await call(`/files/${STATE_DIR}/server.json`)).status).toBe(404)
    await fs.symlink(path.dirname(dir), path.join(dir, 'escape'))
    expect((await call('/files/escape/secret.txt')).status).toBe(403)
    const names = (await adapter().list('')).map((e) => e.name)
    expect(names).not.toContain(STATE_DIR)
    const manifest = await (await call('/.typos/manifest')).json()
    expect(Object.keys(manifest.files).some((f) => f.startsWith(STATE_DIR))).toBe(false)
  })

  it('служебная папка закрыта под любым написанием и по ссылке', async () => {
    for (const name of ['.TYPOS-SERVER', '.Typos-Server', '.typos-server.', '.typos-server%20']) {
      expect(await rawStatus(`/files/${name}/server.json`)).toBe(404)
    }
    await fs.symlink(path.join(dir, STATE_DIR), path.join(dir, 'keys'))
    expect((await call('/files/keys/server.json')).status).toBe(404)
    expect((await adapter().list('')).map((e) => e.name)).not.toContain('keys')
  })

  it('за прокси неверные ключи считаются по адресу клиента, а не прокси', async () => {
    await srv.close()
    srv = await startServer({ dir, port: 0, host: '127.0.0.1', publicUrl: 'https://notes.example.com' })
    base = `http://127.0.0.1:${srv.port}`
    const from = (ip: string, key = 'wrong') =>
      call('/.typos/info', { headers: { Authorization: `Bearer ${key}`, 'X-Forwarded-For': `1.1.1.1, ${ip}` } })
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.7')).status).toBe(401)
    expect((await from('203.0.113.7')).status).toBe(429)
    // другой клиент за тем же прокси не заблокирован
    expect((await from('198.51.100.2', token)).status).toBe(200)
  })

  it('неверный числовой флаг — ошибка, а не молча NaN', async () => {
    const run = promisify(execFile)
    const cli = path.join(import.meta.dirname, 'typos-server.mjs')
    await expect(run(process.execPath, [cli, '--dir', dir, '--max-size', '50mb'])).rejects.toMatchObject({
      stderr: expect.stringMatching(/--max-size/),
    })
    await expect(run(process.execPath, [cli, 'link', '--dir', dir, '--port', 'x'])).rejects.toMatchObject({
      stderr: expect.stringMatching(/--port/),
    })
  })

  it('CORS: предзапрос без ключа, ответ с Origin приложения', async () => {
    const pre = await fetch(`${base}/files/x.md`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://192.168.1.5:4173',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://192.168.1.5:4173')
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/)
    const res = await call('/.typos/info', { headers: { Origin: 'http://192.168.1.5:4173', Authorization: 'Bearer wrong' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('http://192.168.1.5:4173')
    // браузеру не показываем системное окно логина
    expect(res.headers.get('www-authenticate')).toBeNull()
  })
})

/** Всё содержимое хранилища: путь → текст. */
async function snapshot(a: VaultAdapter, dir = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of await a.list(dir)) {
    const p = dir ? `${dir}/${e.name}` : e.name
    if (e.kind === 'dir') Object.assign(out, await snapshot(a, p))
    else out[p] = (await a.readText(p)) ?? ''
  }
  return out
}

describe('хранилище браузера при подключении сервера', () => {
  it('подключение только копирует, отключение возвращает браузерное как было', async () => {
    const browser = createBrowserAdapter()
    const subject = await repo.createSubject(browser, { name: 'История', color: 'blue', icon: 'book' }, 0)
    await repo.createNote(browser, subject, '# Из браузера')
    const before = await snapshot(browser)

    const res = await useVault.getState().connectRemote({ url: base, token, name: 'Тест', vaultId: srv.state.vaultId }, true)
    expect(res.copied).toBeGreaterThan(0)
    expect(useVault.getState().adapter?.kind).toBe('remote')
    await useVault.getState().createNote(useVault.getState().subjects[0].id, '# С сервера')
    await (useVault.getState().adapter as SyncedAdapter).engine.syncNow()
    expect(await snapshot(browser)).toEqual(before)

    await useVault.getState().switchToBrowser()
    expect(useVault.getState().adapter?.kind).toBe('browser')
    expect(useVault.getState().notes.map((n) => n.title)).toEqual(['Из браузера'])
    expect(await snapshot(browser)).toEqual(before)
    expect(await fs.readdir(path.join(dir, 'История', 'Конспекты'))).toHaveLength(2)
  })

  it('ссылка от другого хранилища не подключается', async () => {
    await expect(useVault.getState().connectRemote({ url: base, token, name: 'Тест', vaultId: 'other' }, false)).rejects.toThrow(
      /другого хранилища/,
    )
    expect(useVault.getState().adapter?.kind).not.toBe('remote')
  })
})

describe('связь с сервером', () => {
  const statusBecomes = async (want: ConnectionStatus, ms = 3000) => {
    const until = Date.now() + ms
    while (useConnection.getState().status !== want) {
      if (Date.now() > until) throw new Error(`ждал ${want}, а сейчас ${useConnection.getState().status}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  it('сервер остановили — сразу offline, запустили снова — online', async () => {
    const changes: string[] = []
    const stop = monitorConnection(adapter(), { retryMs: [50], onChange: (s, prev) => changes.push(`${prev}→${s}`) })
    try {
      await statusBecomes('online')
      const port = srv.port
      const stopped = Date.now()
      await srv.close()
      await statusBecomes('offline')
      // поток рвётся сразу, а не по таймауту пульса
      expect(Date.now() - stopped).toBeLessThan(1000)
      srv = await startServer({ dir, port, host: '127.0.0.1' })
      await statusBecomes('online')
      expect(changes).toEqual(['connecting→online', 'online→offline', 'offline→online'])
    } finally {
      stop()
    }
    expect(useConnection.getState().status).toBe('local')
  })

  it('отозванный ключ — revoked, без бесконечных попыток', async () => {
    await srv.close()
    srv = await startServer({ dir, port: 0, host: '127.0.0.1', heartbeatMs: 50 })
    base = `http://127.0.0.1:${srv.port}`
    const stop = monitorConnection(adapter(), { retryMs: [50] })
    try {
      await statusBecomes('online')
      await revokeDevice(dir, 'laptop')
      await statusBecomes('revoked')
    } finally {
      stop()
    }
  })

  it('сервер молчит дольше пульса — связь считается потерянной', async () => {
    // здоровается и замолкает навсегда: так выглядит пропавшая сеть
    const silent = http.createServer((_req, res) =>
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }).write('event: hello\ndata: {}\n\n'),
    )
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r))
    const port = (silent.address() as { port: number }).port
    const stop = monitorConnection(new RemoteAdapter({ url: `http://127.0.0.1:${port}`, token, name: 'x', vaultId: '' }), {
      idleMs: 200,
      retryMs: [5000],
    })
    try {
      await statusBecomes('online')
      await statusBecomes('offline', 2000)
    } finally {
      stop()
      silent.closeAllConnections()
      silent.close()
    }
  })

  it('упавший запрос сразу перепроверяет связь', async () => {
    const a = adapter()
    const stop = monitorConnection(a, { retryMs: [5000] })
    try {
      await statusBecomes('online')
      await srv.close()
      await statusBecomes('offline')
      expect(useConnection.getState().retryAt).toBeGreaterThan(Date.now())
      await expect(a.get('x.md')).rejects.toThrow(/не отвечает/)
    } finally {
      stop()
      srv = await startServer({ dir, port: 0, host: '127.0.0.1' })
    }
  })
})
