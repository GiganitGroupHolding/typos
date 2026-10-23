// @vitest-environment node
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryAdapter } from '@/storage/flatAdapter'
import { createHttpMcpServer } from '../mcp/http'
import { clientKey, createOwnerAuth, ownerAuthConfig, type OwnerAuthConfig } from '../mcp/ownerAuth'

const password = randomBytes(32).toString('base64url')
const salt = randomBytes(16)
const passwordHash = `scrypt:${salt.toString('base64url')}:${scryptSync(password, salt, 32).toString('base64url')}`
const redirect = 'https://chatgpt.example.test/callback'
const adapter = createMemoryAdapter()
let dir: string
let server: Server
let backend: Server
let owner: ReturnType<typeof createOwnerAuth>
let config: OwnerAuthConfig

function mount() {
  owner = createOwnerAuth(config)
  backend = createHttpMcpServer(
    adapter,
    { resource: config.resource, issuer: new URL('/', config.resource).href },
    (token) => owner.provider.verifyAccessToken(token),
    owner.app,
  )
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'typos-owner-'))
  server = createServer((req, res) => backend.emit('request', req, res))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Нет тестового порта')
  config = { resource: new URL(`http://127.0.0.1:${address.port}/mcp`), passwordHash, dataDir: dir }
  mount()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
  await rm(dir, { recursive: true, force: true })
})

const endpoint = (path: string) => new URL(path, config.resource)

async function register() {
  const response = await fetch(endpoint('/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: '<script>Клиент</script>',
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { client_id: string }
}

async function authorize(clientId: string, scope = 'typos offline_access') {
  const verifier = randomBytes(32).toString('base64url')
  const url = endpoint('/authorize')
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    resource: config.resource.href,
    scope,
    state: 'состояние',
  }).toString()
  const response = await fetch(url, { redirect: 'manual' })
  expect(response.status).toBe(200)
  expect(response.headers.get('referrer-policy')).toBe('same-origin')
  expect(response.headers.get('content-security-policy')).toContain(`form-action 'self' ${new URL(redirect).origin};`)
  const html = await response.text()
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  const id = html.match(/name="request" value="([^"]+)"/)?.[1]
  if (!id) throw new Error('Нет формы подтверждения')
  return { verifier, id, cookie: response.headers.get('set-cookie')!.split(';')[0] }
}

async function consent(flow: Awaited<ReturnType<typeof authorize>>, key = password, cookie = flow.cookie, origin = config.resource.origin) {
  return fetch(endpoint('/consent'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Origin: origin },
    body: new URLSearchParams({ request: flow.id, key }),
  })
}

async function token(params: Record<string, string>) {
  return fetch(endpoint('/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ resource: config.resource.href, ...params }),
  })
}

async function connect(scope = 'typos offline_access') {
  const { client_id } = await register()
  const flow = await authorize(client_id, scope)
  const approved = await consent(flow)
  expect(approved.status).toBe(303)
  expect(approved.headers.get('content-security-policy')).toContain(`form-action 'self' ${new URL(redirect).origin};`)
  const callback = new URL(approved.headers.get('location')!)
  expect(callback.searchParams.get('state')).toBe('состояние')
  const params = {
    client_id,
    grant_type: 'authorization_code',
    code: callback.searchParams.get('code')!,
    code_verifier: flow.verifier,
    redirect_uri: redirect,
  }
  expect((await token({ ...params, code_verifier: randomBytes(32).toString('base64url') })).status).toBe(400)
  const response = await token(params)
  expect(response.status).toBe(200)
  expect((await token(params)).status).toBe(400)
  const tokens = (await response.json()) as { access_token: string; refresh_token: string }
  return { client_id, tokens }
}

it('проводит полный OAuth-вход и позволяет ИИ читать и изменять заметки только после подтверждения владельца', async () => {
  const metadata = await (await fetch(endpoint('/.well-known/oauth-authorization-server'))).json()
  expect(metadata).toMatchObject({
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  })
  expect((await fetch(config.resource, { method: 'POST' })).status).toBe(401)
  const { tokens } = await connect()
  const client = new Client({ name: 'owner-test', version: '1' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(config.resource, { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }),
    )
    expect((await client.listTools()).tools).toHaveLength(12)
    expect((await client.callTool({ name: 'create_subject', arguments: { name: 'OAuth-тест' } })).isError).not.toBe(true)
    expect(
      (await client.callTool({ name: 'create_note', arguments: { subject: 'OAuth-тест', title: 'Вход', markdown: 'Запись после входа' } }))
        .isError,
    ).not.toBe(true)
  } finally {
    await client.close()
  }
})

it('не выдаёт код без правильного ключа, cookie, исходного сайта и одноразовой формы', async () => {
  const { client_id } = await register()
  const flow = await authorize(client_id)
  expect((await consent(flow, password, '', config.resource.origin)).status).toBe(400)
  expect((await consent(flow, password, flow.cookie, 'null')).status).toBe(403)
  expect((await consent(flow, password, flow.cookie, 'https://evil.example.com')).status).toBe(403)
  const denied = await consent(flow, 'неправильный-ключ')
  expect(denied.status).toBe(401)
  expect(denied.headers.get('location')).toBeNull()
  expect((await denied.text()).includes('неправильный-ключ')).toBe(false)
  expect((await consent(flow)).status).toBe(303)
  expect((await consent(flow)).status).toBe(400)
})

it('сохраняет разрешения после перезапуска, меняет refresh-токен и отзывает доступ при его повторном использовании', async () => {
  const { client_id, tokens } = await connect()
  mount()
  await expect(owner.provider.verifyAccessToken(tokens.access_token)).resolves.toMatchObject({ clientId: client_id })
  const params = { client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }
  expect((await token({ ...params, resource: 'https://other.example.com/mcp' })).status).toBe(400)
  const refreshed = await token(params)
  expect(refreshed.status).toBe(200)
  const next = (await refreshed.json()) as { access_token: string; refresh_token: string }
  expect(next.refresh_token).not.toBe(tokens.refresh_token)
  await expect(owner.provider.verifyAccessToken(tokens.access_token)).rejects.toThrow()
  await expect(owner.provider.verifyAccessToken(next.access_token)).resolves.toBeDefined()
  expect((await token(params)).status).toBe(400)
  await expect(owner.provider.verifyAccessToken(next.access_token)).rejects.toThrow()
})

it('не хранит открытые ключи и токены и отзывает старые разрешения при смене ключа владельца', async () => {
  const { tokens } = await connect()
  const stored = await readFile(path.join(dir, 'oauth.json'), 'utf8')
  for (const secret of [password, tokens.access_token, tokens.refresh_token]) expect(stored).not.toContain(secret)
  const nextSalt = randomBytes(16)
  config.passwordHash = `scrypt:${nextSalt.toString('base64url')}:${scryptSync(randomBytes(32), nextSalt, 32).toString('base64url')}`
  mount()
  await expect(owner.provider.verifyAccessToken(tokens.access_token)).rejects.toThrow()
})

it('сохраняет выданные scope и не позволяет расширить их при обновлении токена', async () => {
  const { client_id, tokens } = await connect('typos')
  const params = { client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }
  expect((await token({ ...params, scope: 'typos offline_access' })).status).toBe(400)
  const refreshed = await token(params)
  expect(refreshed.status).toBe(200)
  expect(await refreshed.json()).toMatchObject({ scope: 'typos' })
})

it('отзывает разрешение через OAuth и отклоняет просроченные access-токены', async () => {
  const { client_id, tokens } = await connect()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3601_000)
  await expect(owner.provider.verifyAccessToken(tokens.access_token)).rejects.toThrow()
  clock.mockRestore()
  const response = await fetch(endpoint('/revoke'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, token: tokens.refresh_token }),
  })
  expect(response.status).toBe(200)
  await expect(owner.provider.verifyAccessToken(tokens.access_token)).rejects.toThrow()
})

it('ограничивает попытки входа, запрещает небезопасные адреса возврата и требует постоянную папку с хэшем ключа', async () => {
  const invalid = await fetch(endpoint('/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['http://evil.example.com/callback'] }),
  })
  expect(invalid.status).toBe(400)
  for (let i = 0; i < 10; i++) await fetch(endpoint('/consent'), { method: 'POST', headers: { Origin: config.resource.origin } })
  expect((await fetch(endpoint('/consent'), { method: 'POST', headers: { Origin: config.resource.origin } })).status).toBe(429)
  expect(() => ownerAuthConfig(config.resource, {})).toThrow('MCP_OWNER_PASSWORD_HASH')
  expect(() => ownerAuthConfig(config.resource, { MCP_OWNER_PASSWORD_HASH: passwordHash, MCP_AUTH_DATA_DIR: 'relative' })).toThrow(
    'MCP_AUTH_DATA_DIR',
  )
})

it('считает лимиты по клиенту за прокси: посторонний не закрывает вход владельцу', async () => {
  config = { ...config, trustProxy: true }
  mount()
  const attempt = (ip: string) =>
    fetch(endpoint('/consent'), { method: 'POST', headers: { Origin: config.resource.origin, 'X-Forwarded-For': `10.0.0.1, ${ip}` } })
  for (let i = 0; i < 10; i++) await attempt('203.0.113.7')
  expect((await attempt('203.0.113.7')).status).toBe(429)
  expect((await attempt('198.51.100.2')).status).toBe(400)
})

it('чужие регистрации не занимают места клиентов: вытесняется самый старый без разрешений', async () => {
  const { client_id } = await connect()
  const first = await owner.provider.clientsStore.registerClient({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' })
  for (let i = 0; i < 98; i++)
    await owner.provider.clientsStore.registerClient({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' })
  const fresh = await register()
  expect(owner.provider.clientsStore.getClient(fresh.client_id)).toBeDefined()
  expect(owner.provider.clientsStore.getClient(first.client_id)).toBeUndefined()
  // клиент с выданным разрешением не вытесняется, хоть он и самый старый
  expect(owner.provider.clientsStore.getClient(client_id)).toBeDefined()
})

it('ключ лимита для IPv6 — сеть /64, для IPv4 внутри IPv6 — сам IPv4', () => {
  const req = (remoteAddress: string, forwarded?: string) =>
    ({ headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress } }) as unknown as IncomingMessage
  expect(clientKey(req('2001:db8:1:2:3:4:5:6'))).toBe('2001:db8:1:2::/64')
  expect(clientKey(req('2001:db8::1'))).toBe('2001:db8:0:0::/64')
  expect(clientKey(req('::ffff:192.0.2.1'))).toBe('192.0.2.1')
  expect(clientKey(req('127.0.0.1', '203.0.113.7'))).toBe('127.0.0.1')
  expect(clientKey(req('127.0.0.1', '1.1.1.1, 203.0.113.7'), true)).toBe('203.0.113.7')
})
