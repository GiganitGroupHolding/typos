import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { isIPv6 } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import express, { type Response } from 'express'
import { rateLimit } from 'express-rate-limit'

const derive = promisify(scrypt)
const now = () => Math.floor(Date.now() / 1000)
const random = () => randomBytes(32).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'))
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const consentCsp = (redirectUri?: string) =>
  `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${redirectUri ? ` ${new URL(redirectUri).origin}` : ''}; frame-ancestors 'none'; base-uri 'none'`

interface Pending {
  clientId: string
  clientName: string
  params: AuthorizationParams
  cookie: string
  expires: number
}

interface Code {
  clientId: string
  params: AuthorizationParams
  expires: number
}

interface Grant {
  id: string
  clientId: string
  access: string
  refresh: string
  usedRefresh: string[]
  expires: number
  refreshExpires: number
  scopes: string[]
}

interface StateRow {
  kind: string
  id: string
  value: unknown
}

export interface OwnerAuthConfig {
  resource: URL
  passwordHash: string
  dataDir: string
  /** За прокси хостинга (MCP_TRUST_PROXY=1): адрес клиента — последний в X-Forwarded-For. */
  trustProxy?: boolean
}

/** Проверяет настройки личного входа; открытый ключ владельца не нужен серверу. */
export function ownerAuthConfig(resource: URL, env: NodeJS.ProcessEnv): OwnerAuthConfig {
  const passwordHash = env.MCP_OWNER_PASSWORD_HASH ?? ''
  if (!/^scrypt:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/.test(passwordHash))
    throw new Error('Задай MCP_OWNER_PASSWORD_HASH — хэш отдельного ключа владельца MCP')
  const dataDir = env.MCP_AUTH_DATA_DIR ?? ''
  if (!path.isAbsolute(dataDir)) throw new Error('Задай MCP_AUTH_DATA_DIR — абсолютный путь к постоянной папке авторизации')
  return { resource, passwordHash, dataDir, trustProxy: env.MCP_TRUST_PROXY === '1' }
}

/**
 * Ключ лимита запросов — адрес клиента, а не один общий: иначе посторонний исчерпал бы лимиты владельца.
 * За прокси берём адрес, который дописал сам прокси (последний в X-Forwarded-For); IPv6 — по сети /64,
 * у одного абонента обычно целая подсеть. Адрес не разбираем библиотекой: длинная строка из заголовка не должна тормозить.
 */
export function clientKey(req: IncomingMessage, trustProxy = false): string {
  const forwarded = req.headers['x-forwarded-for']
  const ip = ((trustProxy && typeof forwarded === 'string' ? forwarded.split(',').at(-1) : undefined) ?? req.socket.remoteAddress ?? '')
    .trim()
    .slice(0, 64)
  if (!isIPv6(ip)) return ip
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return mapped[1]
  const [head, tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right] : left
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

/** Один владелец, отдельные разрешения клиентов и хэши токенов в постоянной базе. */
class OwnerProvider implements OAuthServerProvider {
  readonly config: OwnerAuthConfig
  private readonly file: string
  private state: StateRow[]
  readonly pending = new Map<string, Pending>()
  readonly codes = new Map<string, Code>()

  constructor(config: OwnerAuthConfig) {
    this.config = config
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
    chmodSync(config.dataDir, 0o700)
    this.file = path.join(config.dataDir, 'oauth.json')
    const state: unknown = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : []
    if (
      !Array.isArray(state) ||
      !state.every((row: unknown) => row && typeof row === 'object' && 'kind' in row && 'id' in row && 'value' in row)
    )
      throw new Error('Повреждена база авторизации — восстанови её из резервной копии или сбрось подключения')
    this.state = state as StateRow[]
    if (existsSync(this.file)) chmodSync(this.file, 0o600)
    const fingerprint = hash(`${config.passwordHash}:${config.resource.href}`)
    if (this.read('setting', 'owner') !== fingerprint) {
      this.persist(this.state.filter((row) => row.kind !== 'grant' && row.kind !== 'setting'))
      this.save('setting', 'owner', fingerprint)
    }
  }

  private read<T>(kind: string, id: string): T | undefined {
    return this.state.find((row) => row.kind === kind && row.id === id)?.value as T | undefined
  }

  private all<T>(kind: string): T[] {
    return this.state.filter((row) => row.kind === kind).map((row) => row.value as T)
  }

  private persist(state: StateRow[]) {
    const temporary = path.join(this.config.dataDir, `oauth-${random()}.tmp`)
    try {
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, JSON.stringify(state))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      // Синхронная атомарная замена сохраняет ротацию токенов до ответа клиенту.
      renameSync(temporary, this.file)
      this.state = state
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  private save(kind: string, id: string, value: unknown) {
    this.persist([...this.state.filter((row) => row.kind !== kind || row.id !== id), { kind, id, value }])
  }

  private remove(kind: string, id: string) {
    this.persist(this.state.filter((row) => row.kind !== kind || row.id !== id))
  }

  private prune() {
    for (const [id, item] of this.pending) if (item.expires <= now()) this.pending.delete(id)
    for (const [id, item] of this.codes) if (item.expires <= now()) this.codes.delete(id)
    for (const item of this.all<Grant>('grant')) if (item.refreshExpires <= now()) this.remove('grant', item.id)
    for (const client of this.all<OAuthClientInformationFull>('client'))
      if ((client.client_id_issued_at ?? 0) + 90 * 86400 <= now()) this.remove('client', client.client_id)
  }

  readonly clientsStore = {
    getClient: (id: string) => this.read<OAuthClientInformationFull>('client', id),
    registerClient: async (client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>) => {
      this.prune()
      this.makeRoomForClient()
      if (client.redirect_uris.length > 5 || client.redirect_uris.length === 0 || (client.client_name?.length ?? 0) > 128)
        throw new InvalidClientMetadataError('Проверь название клиента и адреса возврата')
      for (const value of client.redirect_uris) {
        const url = new URL(value)
        if (url.username || url.password || url.hash || url.protocol !== 'https:')
          throw new InvalidClientMetadataError('Адрес возврата должен быть HTTPS без пароля и фрагмента')
      }
      if (!['none', 'client_secret_post'].includes(client.token_endpoint_auth_method ?? 'client_secret_post'))
        throw new InvalidClientMetadataError('Используй none или client_secret_post')
      const result: OAuthClientInformationFull = { ...client, client_id: random(), client_id_issued_at: now() }
      this.save('client', result.client_id, result)
      return result
    },
  }

  /**
   * Регистрация открыта всем: посторонний мог бы занять все 100 мест на 90 дней и не дать владельцу подключиться.
   * Поэтому место освобождает самый старый клиент без разрешений — у него нет доступа к заметкам.
   */
  private makeRoomForClient() {
    const clients = this.all<OAuthClientInformationFull>('client')
    if (clients.length < 100) return
    const granted = new Set(this.all<Grant>('grant').map((g) => g.clientId))
    const unused = clients
      .filter((c) => !granted.has(c.client_id))
      .sort((a, b) => (a.client_id_issued_at ?? 0) - (b.client_id_issued_at ?? 0))[0]
    if (!unused) throw new InvalidClientMetadataError('Слишком много подключённых клиентов — отключи старые подключения')
    this.remove('client', unused.client_id)
  }

  private resource(resource?: URL) {
    if (!resource || resource.href !== this.config.resource.href) throw new InvalidRequestError('Неверное хранилище MCP')
  }

  private scopes(scopes?: string[]) {
    if (scopes?.some((scope) => !['typos', 'offline_access'].includes(scope)))
      throw new InvalidScopeError('Допустимы typos и offline_access')
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.resource(params.resource)
    this.scopes(params.scopes)
    if (!params.scopes?.includes('typos')) throw new InvalidScopeError('Для доступа к заметкам нужен scope typos')
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError('Нужен PKCE S256')
    this.prune()
    // поток чужих запросов не должен закрыть вход владельцу: вытесняем самый старый незавершённый
    if (this.pending.size >= 100) this.pending.delete(this.pending.keys().next().value!)
    const id = random()
    const cookie = random()
    const pending = {
      clientId: client.client_id,
      clientName: client.client_name ?? 'MCP-клиент',
      params,
      cookie: hash(cookie),
      expires: now() + 600,
    }
    this.pending.set(id, pending)
    res.setHeader('Set-Cookie', `__Host-typos-consent=${cookie}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`)
    this.page(res, id, pending)
  }

  private page(res: Response, id: string, pending: Pending, error = '') {
    // Chromium проверяет form-action и на редиректе после POST, включая возврат в ИИ-клиент.
    res.setHeader('Content-Security-Policy', consentCsp(pending.params.redirectUri))
    res.type('html')
      .send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Подключить TYPOS</title><style>body{font:18px system-ui;max-width:34rem;margin:4rem auto;padding:1rem;color:#202020;background:#fafafa}label,input,button{display:block;margin:1rem 0}input,button{font:inherit;padding:.75rem;box-sizing:border-box;max-width:100%}input{width:100%}code{overflow-wrap:anywhere}.error{color:#a00}</style>
<h1>Подключить TYPOS</h1><p>Клиент <b>${escape(pending.clientName)}</b> получит доступ к чтению и изменению всех заметок этого хранилища.</p>
<p>Адрес возврата: <code>${escape(pending.params.redirectUri)}</code></p><p>Продолжай, только если ты сам начал это подключение в своём ИИ-клиенте.</p>
<p class="error">${escape(error)}</p><form method="post" action="/consent"><input type="hidden" name="request" value="${id}">
<label for="key">Личный ключ владельца MCP</label><input id="key" name="key" type="password" autocomplete="current-password" required maxlength="512">
<button type="submit">Разрешить доступ</button></form><p>Ключ остаётся на этом сервере и не передаётся ИИ-клиенту. Чтобы отменить подключение, закрой страницу.</p></html>`)
  }

  async consent(id: string, cookie: string, key: string, res: Response) {
    const pending = this.pending.get(id)
    if (!pending || pending.expires <= now() || !equal(hash(cookie), pending.cookie)) {
      res.status(400).json({ error: 'Вход устарел — начни подключение заново' })
      return
    }
    const [, salt, expected] = this.config.passwordHash.split(':')
    const actual = (await derive(key, Buffer.from(salt, 'base64url'), 32)) as Buffer
    if (!timingSafeEqual(actual, Buffer.from(expected, 'base64url'))) {
      res.status(401)
      this.page(res, id, pending, 'Ключ не подошёл — проверь его и попробуй снова')
      return
    }
    // Повторный POST, успевший во время scrypt, не должен выдать ещё один код.
    if (!this.pending.delete(id)) {
      res.status(400).json({ error: 'Разрешение уже использовано — начни подключение заново' })
      return
    }
    const code = random()
    this.codes.set(hash(code), { clientId: pending.clientId, params: pending.params, expires: now() + 60 })
    const redirect = new URL(pending.params.redirectUri)
    redirect.searchParams.set('code', code)
    if (pending.params.state !== undefined) redirect.searchParams.set('state', pending.params.state)
    res.setHeader('Content-Security-Policy', consentCsp(pending.params.redirectUri))
    res.setHeader('Set-Cookie', '__Host-typos-consent=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
    res.redirect(303, redirect.href)
  }

  private code(clientId: string, code: string) {
    const item = this.codes.get(hash(code))
    if (!item || item.clientId !== clientId || item.expires <= now()) throw new InvalidGrantError('Код недействителен — подключись заново')
    return item
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    return this.code(client.client_id, code).params.codeChallenge
  }

  private issue(clientId: string, scopes: string[], previous?: Grant): OAuthTokens {
    this.prune()
    if (!previous && this.all('grant').length >= 100) throw new InvalidGrantError('Слишком много разрешений — отключи старые подключения')
    const access = random()
    const refresh = random()
    const grant: Grant = {
      id: previous?.id ?? random(),
      clientId,
      access: hash(access),
      refresh: hash(refresh),
      usedRefresh: previous ? [...previous.usedRefresh, previous.refresh] : [],
      expires: now() + 3600,
      refreshExpires: previous?.refreshExpires ?? now() + 30 * 86400,
      scopes,
    }
    this.save('grant', grant.id, grant)
    return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: scopes.join(' ') }
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    this.resource(resource)
    const item = this.code(client.client_id, code)
    if (redirectUri !== item.params.redirectUri) throw new InvalidGrantError('Адрес возврата не совпал')
    this.codes.delete(hash(code))
    return this.issue(client.client_id, item.params.scopes ?? ['typos'])
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, token: string, scopes?: string[], resource?: URL) {
    this.resource(resource)
    this.scopes(scopes)
    const value = hash(token)
    for (const grant of this.all<Grant>('grant')) {
      if (grant.clientId !== client.client_id) continue
      if (grant.usedRefresh.includes(value)) {
        this.remove('grant', grant.id)
        throw new InvalidGrantError('Повторно использованный токен — подключись заново')
      }
      if (grant.refresh !== value) continue
      if (grant.refreshExpires <= now() || grant.usedRefresh.length >= 2048) {
        this.remove('grant', grant.id)
        break
      }
      if (scopes?.some((scope) => !grant.scopes.includes(scope)) || (scopes && !scopes.includes('typos')))
        throw new InvalidScopeError('Нельзя расширить разрешение или убрать scope typos')
      return this.issue(client.client_id, scopes ?? grant.scopes, grant)
    }
    throw new InvalidGrantError('Разрешение истекло или отозвано — подключись заново')
  }

  async verifyAccessToken(token: string) {
    const value = hash(token)
    const grant = this.all<Grant>('grant').find((item) => item.access === value && item.expires > now())
    if (!grant) throw new InvalidTokenError('Войди заново')
    return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: grant.expires, resource: this.config.resource }
  }

  async revokeToken(client: OAuthClientInformationFull, request: { token: string }) {
    const value = hash(request.token)
    for (const grant of this.all<Grant>('grant'))
      if (grant.clientId === client.client_id && [grant.access, grant.refresh, ...grant.usedRefresh].includes(value))
        this.remove('grant', grant.id)
  }
}

/** SDK проверяет OAuth и PKCE; форма отдельно подтверждает доступ владельца к этому клиенту. */
export function createOwnerAuth(config: OwnerAuthConfig) {
  const provider = new OwnerProvider(config)
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    // no-referrer превращает Origin обычной POST-формы в null и ломает проверку CSRF.
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', consentCsp())
    next()
  })
  app.use(express.json({ limit: '8kb' }), express.urlencoded({ extended: false, limit: '8kb' }))
  // X-Forwarded-For проверяет clientKey: проверка библиотеки ругалась бы на него без «trust proxy» Express
  const byClient = {
    keyGenerator: (req: IncomingMessage) => clientKey(req, config.trustProxy),
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  }
  const tooMany = { error: 'Слишком много попыток — подожди 15 минут' }
  app.post(
    '/consent',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: tooMany, ...byClient }),
    // общий предел — только против нагрузки scrypt; подобрать 32-байтовый ключ владельца перебором нельзя
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, keyGenerator: () => 'all', message: tooMany }),
    async (req, res) => {
      if (req.headers.origin !== config.resource.origin) {
        res.status(403).json({ error: 'Недопустимый источник запроса' })
        return
      }
      const body = (req.body ?? {}) as Record<string, unknown>
      const cookie =
        req.headers.cookie
          ?.split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('__Host-typos-consent='))
          ?.slice(21) ?? ''
      if (typeof body.request !== 'string' || typeof body.key !== 'string' || body.key.length > 512) {
        res.status(400).json({ error: 'Проверь форму входа' })
        return
      }
      await provider.consent(body.request, cookie, body.key, res)
    },
  )
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL('/', config.resource),
      resourceServerUrl: config.resource,
      scopesSupported: ['typos', 'offline_access'],
      authorizationOptions: { rateLimit: byClient },
      tokenOptions: { rateLimit: byClient },
      revocationOptions: { rateLimit: byClient },
      clientRegistrationOptions: { clientSecretExpirySeconds: 0, rateLimit: byClient },
    }),
  )
  app.use((_req, res) => {
    res.status(404).json({ error: 'Не найдено' })
  })
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: 'Не получилось обработать запрос входа — начни подключение заново' })
  })
  return { provider, app }
}
