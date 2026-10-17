// @vitest-environment node
// Картинки — Blob; в jsdom поддельный IndexedDB их портит, а в браузере и в Node они хранятся как есть
import 'fake-indexeddb/auto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { RemoteAdapter } from '@/storage/remoteAdapter'
import { SyncedAdapter } from '@/storage/syncedAdapter'
import { deviceKey, startServer } from './typos-server.mjs'

let dir: string
let srv: Awaited<ReturnType<typeof startServer>>

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'typos-sync-bin-'))
  srv = await startServer({ dir, port: 0, host: '127.0.0.1' })
})

afterEach(async () => {
  await srv.close()
  await fs.rm(dir, { recursive: true, force: true })
})

it('картинки ходят между устройствами в обе стороны', async () => {
  const config = { url: `http://127.0.0.1:${srv.port}`, token: (await deviceKey(dir)).token, name: 'Тест', vaultId: srv.state.vaultId }
  const [a, b] = [new SyncedAdapter(config, 'a'), new SyncedAdapter(config, 'b')]
  await a.initialSync()
  await b.initialSync()
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3])
  await a.writeBlob('Физика/Конспекты/assets/x.webp', new Blob([bytes], { type: 'image/webp' }))
  await a.engine.syncNow()
  expect(new Uint8Array(await fs.readFile(path.join(dir, 'Физика/Конспекты/assets/x.webp')))).toEqual(bytes)
  await b.engine.syncNow()
  const got = await b.readBlob('Физика/Конспекты/assets/x.webp')
  expect(new Uint8Array(await got!.arrayBuffer())).toEqual(bytes)
  expect(await new RemoteAdapter(config).exists('Физика/Конспекты/assets/x.webp')).toBe(true)
})
