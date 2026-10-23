// @vitest-environment node
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DavAdapter } from '@/storage/davAdapter'
import { createHttpMcpServer, createTokenVerifier, httpConfig, type HttpConfig } from '../mcp/http'
import { deviceKey, startServer } from './typos-server.mjs'

const keys = await generateKeyPair('ES256')
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' }
let dir: string
let storage: Awaited<ReturnType<typeof startServer>>
let http: Server
let jwks: Server
let config: HttpConfig
let adapter: DavAdapter
let client: Client | undefined
let jwksRequests: number

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Нет порта тестового сервера')
  return `http://127.0.0.1:${address.port}`
}

const close = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((e) => (e ? reject(e) : resolve()))
    server.closeAllConnections()
  })

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'typos-http-'))
  storage = await startServer({ dir, port: 0, host: '127.0.0.1' })
  adapter = new DavAdapter({
    url: `http://127.0.0.1:${storage.port}`,
    token: (await deviceKey(dir, 'mcp')).token,
    name: 'Тест',
    vaultId: storage.state.vaultId,
  })
  jwksRequests = 0
  jwks = createServer((_req, res) => {
    jwksRequests++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  const jwksUrl = new URL(await listen(jwks))
  config = { resource: new URL('http://127.0.0.1/mcp'), issuer: 'https://auth.example.com/', jwksUrl, subject: 'owner' }
  http = createHttpMcpServer(adapter, config, createTokenVerifier(config))
  config.resource = new URL(`${await listen(http)}/mcp`)
})

afterEach(async () => {
  await client?.close()
  client = undefined
  await close(http)
  await close(jwks)
  await storage.close()
  await rm(dir, { recursive: true, force: true })
})

function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({ scope: 'typos', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setIssuer(config.issuer)
    .setAudience(config.resource.href)
    .setSubject('owner')
    .setIssuedAt()
    .setExpirationTime('5m')
}

async function connect() {
  client = new Client({ name: 'http-test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(config.resource, {
      requestInit: { headers: { Authorization: `Bearer ${await token().sign(keys.privateKey)}` } },
    }),
  )
  return client
}

function data(result: Awaited<ReturnType<Client['callTool']>>) {
  return JSON.parse((result.content as { text: string }[])[0].text)
}

it('публикует OAuth-метаданные и healthcheck, но не пускает к инструментам без авторизации', async () => {
  expect((await fetch(new URL('/healthz', config.resource))).status).toBe(200)
  const metadata = await fetch(new URL('/.well-known/oauth-protected-resource/mcp', config.resource))
  expect(await metadata.json()).toMatchObject({ resource: config.resource.href, authorization_servers: [config.issuer] })
  const denied = await fetch(config.resource, { method: 'POST' })
  expect(denied.status).toBe(401)
  expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=')
})

it('проверяет подпись, срок, issuer, audience, владельца и scope каждого запроса', async () => {
  const other = await generateKeyPair('ES256')
  const invalid = [
    await token().sign(other.privateKey),
    await token().setExpirationTime('0s').sign(keys.privateKey),
    await token().setIssuer('https://other.example.com/').sign(keys.privateKey),
    await token().setAudience('https://other.example.com/mcp').sign(keys.privateKey),
    await token().setSubject('stranger').sign(keys.privateKey),
    await token({ scope: 'other' }).sign(keys.privateKey),
  ]
  for (const value of invalid) {
    const response = await fetch(config.resource, { method: 'POST', headers: { Authorization: `Bearer ${value}` } })
    expect(response.status).toBe(401)
  }
  await connect()
  expect((await client!.listTools()).tools).toHaveLength(15)
})

it('создаёт, читает, меняет и удаляет конспект через HTTP и настоящий сервер хранения', async () => {
  const c = await connect()
  await c.callTool({ name: 'create_subject', arguments: { name: 'Тест' } })
  const created = data(await c.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'HTTP', markdown: 'Первая версия' } }))
  expect(created.action).toBe('created')
  expect(await adapter.readText(created.path)).toContain('Первая версия')
  await c.callTool({ name: 'update_note', arguments: { id: created.id, mode: 'append', markdown: 'Вторая строка' } })
  expect(data(await c.callTool({ name: 'read_note', arguments: { id: created.id } })).markdown).toContain('Вторая строка')
  expect(data(await c.callTool({ name: 'search', arguments: { query: 'Вторая' } }))).toHaveLength(1)
  await c.callTool({ name: 'trash', arguments: { kind: 'note', id: created.id } })
  expect(data(await c.callTool({ name: 'search', arguments: { query: 'Вторая' } }))).toHaveLength(0)
})

it('не раскрывает файловые инструменты и не читает файлы или сетевые адреса для картинок', async () => {
  const c = await connect()
  const { tools } = await c.listTools()
  expect(tools.some((t) => t.name === 'add_project_file')).toBe(false)
  for (const name of ['create_note', 'update_note', 'import_tool']) {
    expect(tools.find((t) => t.name === name)?.inputSchema.properties).not.toHaveProperty('file')
  }
  await c.callTool({ name: 'create_subject', arguments: { name: 'Тест' } })
  expect((await c.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Файл', file: '/etc/passwd' } })).isError).toBe(true)
  const externalImage = new URL('/secret', config.jwksUrl).href
  const requestsBeforeImages = jwksRequests
  for (const source of ['/etc/passwd', externalImage]) {
    expect((await c.callTool({ name: 'add_image', arguments: { subject: 'Тест', source } })).isError).toBe(true)
  }
  const note = data(
    await c.callTool({ name: 'create_note', arguments: { subject: 'Тест', title: 'Картинка', markdown: `![x](${externalImage})` } }),
  )
  expect(note.warnings).toHaveLength(1)
  expect(jwksRequests).toBe(requestsBeforeImages)
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
    .png()
    .toBuffer()
  const image = data(
    await c.callTool({ name: 'add_image', arguments: { subject: 'Тест', source: `data:image/png;base64,${png.toString('base64')}` } }),
  )
  expect(image.path).toMatch(/\.webp$/)
  expect((await adapter.readBlob(image.path))?.size).toBeGreaterThan(0)
})

it('отклоняет чужие Host и Origin и ограничивает размер тела запроса', async () => {
  const headers = { Authorization: `Bearer ${await token().sign(keys.privateKey)}` }
  expect((await fetch(config.resource, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example.com' } })).status).toBe(403)
  // fetch нормализует Host — для этой проверки отправляем HTTP-заголовок напрямую.
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(config.resource, { method: 'POST', headers: { ...headers, Host: 'evil.example.com' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  expect(hostStatus).toBe(403)
  const response = await fetch(config.resource, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ padding: 'a'.repeat(4 * 1024 * 1024) }),
  })
  expect(response.status).toBe(413)
})

it('не запускается с неполной авторизацией или небезопасными публичными адресами', () => {
  expect(() => httpConfig({})).toThrow('MCP_PUBLIC_URL')
  const env = {
    MCP_PUBLIC_URL: 'https://mcp.example.com/mcp',
    MCP_AUTH_ISSUER: 'https://auth.example.com/',
    MCP_AUTH_JWKS_URL: 'https://auth.example.com/jwks',
    MCP_AUTH_SUBJECT: 'owner',
  }
  expect(httpConfig(env).subject).toBe('owner')
  expect(() => httpConfig({ ...env, MCP_PUBLIC_URL: 'http://mcp.example.com/mcp' })).toThrow('HTTPS')
  expect(() => httpConfig({ ...env, MCP_AUTH_JWKS_URL: 'https://user:password@auth.example.com/jwks' })).toThrow('HTTPS')
})
