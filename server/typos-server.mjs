#!/usr/bin/env node
/*
 * Сервер хранения TYPOS: папка vault на своём сервере, приложение подключается по ссылке.
 * Один файл, без зависимостей, Node 18+ (правки прямо в папке устройства видят сразу с Node 20). Скопируй на сервер и запусти:
 *
 *   node typos-server.mjs --dir ./vault              запустить и показать ссылку подключения
 *   node typos-server.mjs link --dir ./vault         показать ссылку снова
 *   node typos-server.mjs link phone --dir ./vault   отдельный ключ для устройства (чтобы отключать по одному)
 *   node typos-server.mjs revoke phone --dir ./vault отключить устройство
 *   node typos-server.mjs --help                     все команды и флаги
 *
 * Протокол — подмножество WebDAV под /files/ (папку можно подключить и в проводнике),
 * плюс /.typos/info, /.typos/manifest и /.typos/events (поток: приложение сразу видит, что сервер пропал).
 * Аккаунтов нет: доступ по ключу из ссылки. Все ключи открывают одно и то же хранилище.
 * Ключи лежат в .typos-server/server.json внутри vault; эту папку сервер не отдаёт ни под каким написанием и ни по какой ссылке.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, promises as fs, watch as watchFs } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const PROTOCOL = 'typos-storage/1'
export const STATE_DIR = '.typos-server'
const DEFAULT_PORT = 8787
const FILES = '/files'
const METHODS = 'OPTIONS, GET, HEAD, PUT, DELETE, MOVE, MKCOL, PROPFIND'
const ALLOW_HEADERS = 'Authorization, Content-Type, Depth, Destination, Overwrite, If-Match, If-None-Match, X-Typos-Prune'
/** Временные файлы атомарной записи: «имя.1a2b3c4d.tmp» (так же пишет MCP-сервер). */
const TMP_RE = /\.[0-9a-f]{8}\.tmp$/
const DEVICE_RE = /^[\p{L}\p{N}_.-]{1,40}$/u

/**
 * @typedef {{ name: string, token: string, created: string }} Device
 * @typedef {{ port: number, host: string, tls: boolean, publicUrl?: string }} Listen
 * @typedef {{ vaultId: string, name: string, devices: Device[], listen?: Listen }} ServerState
 * @typedef {{ etag: string, size: number, mtime: string }} ManifestFile
 */

class HttpError extends Error {
  /** @param {number} status @param {string} [message] */
  constructor(status, message) {
    super(message ?? http.STATUS_CODES[status] ?? String(status))
    this.status = status
  }
}

/** @param {unknown} e */
const isMissing = (e) => /** @type {NodeJS.ErrnoException} */ (e)?.code === 'ENOENT'

/**
 * Служебная папка под любым написанием: на macOS и Windows «.TYPOS-SERVER» и «.typos-server.» — та же папка.
 * @param {string} name
 */
const isStateDir = (name) => name.toLowerCase().replace(/[. ]+$/, '') === STATE_DIR

/**
 * Пишет во временный «имя.1a2b3c4d.tmp» и переименовывает — никто не прочитает файл наполовину.
 * @param {string} file @param {string | Buffer} data @param {number} [mode]
 */
async function writeAtomic(file, data, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, data, { mode })
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

// ---------- состояние: id хранилища, имя, ключи устройств ----------

/** @param {string} root */
const statePath = (root) => path.join(root, STATE_DIR, 'server.json')
/** @param {string} root */
const seenPath = (root) => path.join(root, STATE_DIR, 'seen.json')

/** @param {string} root @returns {Promise<ServerState | null>} */
export async function loadState(root) {
  try {
    const s = JSON.parse(await fs.readFile(statePath(root), 'utf8'))
    return { ...s, devices: Array.isArray(s.devices) ? s.devices : [] }
  } catch (e) {
    if (isMissing(e)) return null
    throw e
  }
}

/** @param {string} file @param {unknown} data */
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeAtomic(file, JSON.stringify(data, null, 2) + '\n', 0o600)
}

/** @param {string} root @param {string} [name] @returns {Promise<ServerState>} */
export async function ensureState(root, name) {
  const s = await loadState(root)
  if (s && (!name || s.name === name)) return s
  const next = s
    ? { ...s, name: /** @type {string} */ (name) }
    : { vaultId: randomBytes(8).toString('hex'), name: name || path.basename(path.resolve(root)), devices: [] }
  await writeJson(statePath(root), next)
  return next
}

/** @param {string} token */
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export const DEFAULT_DEVICE = 'default'

/**
 * Ключ устройства. Нового устройства ещё нет — заводит ключ; есть — возвращает тот же (ссылку можно показать снова).
 * Ключ лежит открыто, как и сами конспекты рядом: кто может прочитать server.json, прочитает и vault.
 * @param {string} root @param {string} device
 */
export async function deviceKey(root, device = DEFAULT_DEVICE) {
  const state = await ensureState(root)
  const existing = state.devices.find((d) => d.name === device)
  if (existing) return { state, token: existing.token, created: false }
  return { ...(await rotateDevice(root, device)), created: !existing }
}

/**
 * Новый ключ устройству; старая ссылка этого устройства перестаёт работать.
 * @param {string} root @param {string} device
 */
export async function rotateDevice(root, device) {
  if (!DEVICE_RE.test(device)) throw new Error(`Имя устройства — буквы, цифры, «_.-», до 40 символов: ${device}`)
  const state = await ensureState(root)
  const token = randomBytes(32).toString('base64url')
  state.devices = [...state.devices.filter((d) => d.name !== device), { name: device, token, created: new Date().toISOString() }]
  await writeJson(statePath(root), state)
  return { state, token }
}

/** @param {string} root @param {string} device */
export async function revokeDevice(root, device) {
  const state = await loadState(root)
  if (!state?.devices.some((d) => d.name === device)) return false
  state.devices = state.devices.filter((d) => d.name !== device)
  await writeJson(statePath(root), state)
  return true
}

// ---------- ссылка подключения ----------

/**
 * typos://host:port/путь?n=имя&id=vaultId&k=ключ[&tls=1] — вставляется в TYPOS.
 * @param {{ base: string, token: string, name: string, vaultId: string }} p
 */
export function buildLink({ base, token, name, vaultId }) {
  const u = new URL(base)
  const q = new URLSearchParams({ n: name, id: vaultId, k: token })
  if (u.protocol === 'https:') q.set('tls', '1')
  return `typos://${u.host}${u.pathname.replace(/\/+$/, '')}?${q}`
}

/** Туннели VPN: WireGuard, OpenVPN, Tailscale, ZeroTier. */
const VPN_IF = /^(tun|tap|wg|tailscale|utun|zt|ppp)/

/**
 * Кому подходит адрес: TYPOS открыт на этом же компьютере, в локальной сети, через VPN или из интернета.
 * @param {string} ip @param {string} [iface]
 */
function addressKind(ip, iface = '') {
  if (ip === 'localhost' || ip === '::1' || ip.startsWith('127.')) return 'на этом же компьютере (localhost)'
  if (VPN_IF.test(iface)) return `через VPN ${iface} (${ip})`
  const [a, b] = ip.split('.').map(Number)
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return `на другом устройстве в локальной сети (${ip})`
  if (a === 100 && b >= 64 && b <= 127) return `через Tailscale или другой VPN (${ip})`
  return `через интернет (${ip}) — лучше с HTTPS`
}

/** Виртуальные сети Docker, Kubernetes и виртуалок — с других устройств их не видно. */
const VIRTUAL_IF = /^(docker|br-|veth|virbr|vmnet|cni|flannel|kube|podman|lxc|lxd)/

/**
 * Адреса для ссылок, с подписью, когда какой брать.
 * @param {Listen} l @returns {{ label: string, base: string }[]}
 */
export function connectionTargets(l) {
  if (l.publicUrl) return [{ label: `по внешнему адресу (${new URL(l.publicUrl).host})`, base: l.publicUrl }]
  const proto = l.tls ? 'https' : 'http'
  /** @param {string} h @param {string} [iface] */
  const target = (h, iface) => ({ label: addressKind(h, iface), base: `${proto}://${h.includes(':') ? `[${h}]` : h}:${l.port}` })
  if (l.host && l.host !== '0.0.0.0' && l.host !== '::')
    return [target(l.host.startsWith('127.') || l.host === '::1' ? 'localhost' : l.host)]
  const found = Object.entries(os.networkInterfaces())
    .filter(([name]) => !VIRTUAL_IF.test(name))
    .flatMap(([name, list]) => (list ?? []).map((i) => ({ ...i, name })))
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
  // локальная сеть — первой, туннели — после
  found.sort((x, y) => Number(VPN_IF.test(x.name)) - Number(VPN_IF.test(y.name)))
  return [target('localhost'), ...found.map((i) => target(i.address, i.name))]
}

// ---------- пути ----------

/**
 * «/files/Физика/Конспекты/x.md» → ['Физика', 'Конспекты', 'x.md']. Служебную папку и выход за корень не пускает.
 * @param {string} pathname
 */
function vaultParts(pathname) {
  let parts
  try {
    parts = pathname.slice(FILES.length).split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    throw new HttpError(400, 'Битый путь')
  }
  if (parts.some((p) => p === '.' || p === '..' || /[\\/:\0]/.test(p))) throw new HttpError(400, 'Недопустимый путь')
  if (parts.length && isStateDir(parts[0])) throw new HttpError(404)
  return parts
}

/** @param {string[]} parts */
const encodeParts = (parts) => parts.map(encodeURIComponent).join('/')

/** @param {string} abs */
async function statOrNull(abs) {
  try {
    return await fs.stat(abs)
  } catch (e) {
    if (isMissing(e)) return null
    throw e
  }
}

/** @param {string} value */
const xml = (value) => value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

const CONTENT_TYPES = /** @type {Record<string, string>} */ ({
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
})
/** HTML тулз отдаём как байты: на сервере их не исполняем. @param {string} name */
const contentType = (name) => CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'

// ---------- сервер ----------

/**
 * @typedef {{
 *   dir: string, port?: number, host?: string, name?: string, publicUrl?: string,
 *   cert?: string, key?: string, origins?: string[], maxSize?: number, heartbeatMs?: number, log?: (line: string) => void
 * }} ServerOptions
 */

/** @param {string} ip */
const isLoopback = (ip) => ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.')

/** @param {ServerOptions} opts */
export async function startServer(opts) {
  const root = path.resolve(opts.dir)
  await fs.mkdir(root, { recursive: true })
  const rootReal = await fs.realpath(root)
  const maxSize = opts.maxSize ?? 50 * 1024 * 1024
  const origins = opts.origins ?? []
  const log = opts.log ?? (() => {})
  let state = await ensureState(root, opts.name)
  const stateReal = await fs.realpath(path.join(root, STATE_DIR))
  /** @param {string} real */
  const insideRoot = (real) => real === rootReal || real.startsWith(rootReal + path.sep)
  /** @param {string} real */
  const insideState = (real) => real === stateReal || real.startsWith(stateReal + path.sep)

  // ключи можно добавить и отозвать командой, пока сервер работает — перечитываем server.json при изменении
  let stateMtime = (await fs.stat(statePath(root))).mtimeMs
  let stateChecked = 0
  const currentState = async () => {
    const now = Date.now()
    if (now - stateChecked < 1000) return state
    stateChecked = now
    const st = await statOrNull(statePath(root))
    if (st && st.mtimeMs !== stateMtime) {
      state = (await loadState(root)) ?? state
      stateMtime = st.mtimeMs
    }
    return state
  }

  /** @type {Record<string, string>} */
  const seen = await fs.readFile(seenPath(root), 'utf8').then(JSON.parse, () => ({}))
  let seenDirty = false
  const flushSeen = async () => {
    if (!seenDirty) return
    seenDirty = false
    await writeJson(seenPath(root), seen).catch((e) => log(`seen.json: ${e.message}`))
  }
  /** Подбор ключа: 10 ошибок за минуту — минута паузы для этого адреса. */
  /** @type {Map<string, { fails: number, last: number, until: number }>} */
  const failures = new Map()

  const housekeeping = setInterval(() => {
    void flushSeen()
    const now = Date.now()
    for (const [ip, f] of failures) if (f.until <= now && now - f.last > 60_000) failures.delete(ip)
  }, 60_000)
  housekeeping.unref()

  // открытые потоки /.typos/events: пульс держит связь, отозванному ключу — сразу сообщаем и закрываем
  /** @type {Set<{ res: http.ServerResponse, device: string }>} */
  const streams = new Set()
  // что-то изменилось (запись через сервер или правка прямо в папке) — устройства сразу забирают изменения
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let changeTimer
  const notifyChange = () => {
    clearTimeout(changeTimer)
    changeTimer = setTimeout(() => {
      for (const s of streams) s.res.write('event: change\ndata: {}\n\n')
    }, 100)
  }
  /** @type {import('node:fs').FSWatcher | undefined} */
  let watcher
  try {
    // рекурсивное слежение есть в Node 20+ (на Linux); без него — только изменения через сам сервер
    watcher = watchFs(rootReal, { recursive: true }, (_event, name) => {
      const rel = String(name ?? '')
      if (isStateDir(rel.split(path.sep)[0]) || TMP_RE.test(rel)) return
      notifyChange()
    })
    watcher.on('error', () => watcher?.close())
  } catch {
    log(
      'слежение за папкой недоступно в этой версии Node — изменения, сделанные мимо сервера, устройства увидят при следующей синхронизации',
    )
  }

  const heartbeat = setInterval(async () => {
    if (!streams.size) return
    try {
      const devices = new Set((await currentState()).devices.map((d) => d.name))
      for (const s of streams) {
        if (devices.has(s.device)) s.res.write(': ping\n\n')
        else s.res.end('event: revoked\ndata: {}\n\n')
      }
    } catch (e) {
      // битый server.json не должен ронять сервер: пульс пропустим, потоки закроются по таймауту
      log(`пульс: ${e instanceof Error ? e.message : e}`)
    }
  }, opts.heartbeatMs ?? 10_000)
  heartbeat.unref()

  /**
   * Адрес клиента для счётчика неверных ключей. За прокси (--public-url) все запросы приходят с localhost —
   * тогда берём адрес, который дописал сам прокси: последний в X-Forwarded-For (первые клиент может подделать).
   * @param {http.IncomingMessage} req
   */
  const clientIp = (req) => {
    const peer = req.socket.remoteAddress ?? ''
    const forwarded = req.headers['x-forwarded-for']
    if (!opts.publicUrl || !isLoopback(peer) || typeof forwarded !== 'string') return peer
    return forwarded.split(',').at(-1)?.trim() || peer
  }

  /** @param {http.IncomingMessage} req @returns {Promise<string | null>} */
  const authenticate = async (req) => {
    const header = req.headers.authorization ?? ''
    let token = ''
    if (header.startsWith('Bearer ')) token = header.slice(7).trim()
    else if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      token = decoded.slice(decoded.indexOf(':') + 1)
    }
    if (!token) return null
    const hash = Buffer.from(hashToken(token), 'hex')
    // сравниваем хэши: одинаковая длина для timingSafeEqual и время не зависит от совпавших символов
    for (const d of (await currentState()).devices) {
      if (timingSafeEqual(Buffer.from(hashToken(d.token), 'hex'), hash)) return d.name
    }
    return null
  }

  // ETag — хэш содержимого; пересчитываем, только когда файл поменялся
  /** @type {Map<string, { key: string, etag: string }>} */
  const etags = new Map()
  /** @param {import('node:fs').Stats} st */
  const statKey = (st) => `${st.ino}:${st.size}:${st.mtimeMs}`
  /** @param {Buffer} buf */
  const etagOfBuffer = (buf) => `"${createHash('sha1').update(buf).digest('base64url')}"`
  /** @param {string} abs @param {import('node:fs').Stats} st */
  const etagOf = async (abs, st) => {
    const hit = etags.get(abs)
    if (hit?.key === statKey(st)) return hit.etag
    const etag = etagOfBuffer(await fs.readFile(abs))
    etags.set(abs, { key: statKey(st), etag })
    return etag
  }
  /** Файл или папку удалили или перенесли — их ETag больше не нужны. @param {string} abs */
  const forgetEtags = (abs) => {
    for (const key of etags.keys()) if (key === abs || key.startsWith(abs + path.sep)) etags.delete(key)
  }

  /** Абсолютный путь внутри корня; ссылки, ведущие наружу или в служебную папку, не пускает. @param {string[]} parts */
  const resolve = async (parts) => {
    const abs = path.join(rootReal, ...parts)
    for (let probe = abs; ; probe = path.dirname(probe)) {
      try {
        const real = await fs.realpath(probe)
        if (!insideRoot(real)) throw new HttpError(403, 'Путь вне хранилища')
        if (insideState(real)) throw new HttpError(404)
        return abs
      } catch (e) {
        if (!isMissing(e)) throw e
      }
    }
  }

  // изменения идут строго по очереди: проверка If-Match и запись не перемешиваются
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()
  /** @template T @param {() => Promise<T>} job @returns {Promise<T>} */
  const exclusive = (job) => {
    const next = queue.then(job, job)
    queue = next.catch(() => {})
    return next
  }

  /** @param {string | undefined} header @param {string | null} etag */
  const matches = (header, etag) =>
    header !== undefined &&
    header
      .split(',')
      .map((s) => s.trim())
      .some((s) => (s === '*' ? etag !== null : s === etag || s === `W/${etag}`))

  /** @param {http.IncomingMessage} req @param {string | null} etag */
  const checkPreconditions = (req, etag) => {
    const ifMatch = req.headers['if-match']
    const ifNoneMatch = req.headers['if-none-match']
    if (ifMatch !== undefined && !matches(ifMatch, etag)) throw new HttpError(412, 'Файл изменился')
    if (ifNoneMatch !== undefined && matches(ifNoneMatch, etag)) throw new HttpError(412, 'Файл уже есть')
  }

  /** @param {http.IncomingMessage} req @returns {Promise<Buffer>} */
  const readBody = (req) =>
    new Promise((resolveBody, reject) => {
      if (Number(req.headers['content-length'] ?? 0) > maxSize) {
        req.resume()
        reject(new HttpError(413, 'Файл слишком большой'))
        return
      }
      /** @type {Buffer[]} */
      const chunks = []
      let size = 0
      req.on('data', (/** @type {Buffer} */ c) => {
        size += c.length
        if (size <= maxSize) chunks.push(c)
      })
      req.on('end', () => (size > maxSize ? reject(new HttpError(413, 'Файл слишком большой')) : resolveBody(Buffer.concat(chunks))))
      req.on('error', reject)
    })

  /** @param {string} dir @param {string} name */
  const hidden = (dir, name) => (dir === rootReal && isStateDir(name)) || TMP_RE.test(name)

  /** Содержимое папки без служебного и без ссылок, ведущих за корень или в служебную папку. @param {string} abs */
  const children = async (abs) => {
    const out = []
    for (const d of await fs.readdir(abs, { withFileTypes: true })) {
      if (hidden(abs, d.name)) continue
      const childAbs = path.join(abs, d.name)
      if (d.isSymbolicLink()) {
        const real = await fs.realpath(childAbs).catch(() => null)
        if (!real || !insideRoot(real) || insideState(real)) continue
      }
      const st = await statOrNull(childAbs)
      if (st && (st.isFile() || st.isDirectory())) out.push({ name: d.name, abs: childAbs, st })
    }
    return out
  }

  /** @param {string[]} parts @param {string} abs @param {import('node:fs').Stats} st */
  const propEntry = async (parts, abs, st) => {
    const isDir = st.isDirectory()
    const href = `${FILES}/${encodeParts(parts)}${isDir && parts.length ? '/' : ''}`
    const props = isDir
      ? '<d:resourcetype><d:collection/></d:resourcetype>'
      : `<d:resourcetype/><d:getcontentlength>${st.size}</d:getcontentlength>` +
        `<d:getetag>${xml(await etagOf(abs, st))}</d:getetag><d:getcontenttype>${xml(contentType(abs))}</d:getcontenttype>`
    return (
      `<d:response><d:href>${xml(href)}</d:href><d:propstat><d:prop>` +
      `<d:displayname>${xml(parts.at(-1) ?? '')}</d:displayname>${props}` +
      `<d:getlastmodified>${st.mtime.toUTCString()}</d:getlastmodified>` +
      `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    )
  }

  /** Все файлы и папки vault одним списком — для синхронизации. */
  const manifest = async () => {
    /** @type {Record<string, ManifestFile>} */
    const files = {}
    /** @type {string[]} */
    const dirs = []
    // ссылка внутри vault на свою же папку не должна зациклить обход
    const visited = new Set()
    /** @param {string} abs @param {string} rel */
    const walk = async (abs, rel) => {
      const real = await fs.realpath(abs)
      if (visited.has(real)) return
      visited.add(real)
      for (const c of await children(abs)) {
        const childRel = rel ? `${rel}/${c.name}` : c.name
        if (c.st.isDirectory()) {
          dirs.push(childRel)
          await walk(c.abs, childRel)
        } else {
          files[childRel] = { etag: await etagOf(c.abs, c.st), size: c.st.size, mtime: c.st.mtime.toISOString() }
        }
      }
    }
    await walk(rootReal, '')
    return { files, dirs }
  }

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {string[]} parts */
  const dav = async (req, res, parts) => {
    const abs = await resolve(parts)
    switch (req.method) {
      case 'OPTIONS':
        res.writeHead(200, { DAV: '1', Allow: METHODS, 'Content-Length': 0 }).end()
        return
      case 'GET':
      case 'HEAD': {
        const st = await statOrNull(abs)
        if (!st) throw new HttpError(404)
        if (!st.isFile()) throw new HttpError(405, 'Это папка')
        const etag = await etagOf(abs, st)
        if (matches(req.headers['if-none-match'], etag)) {
          res.writeHead(304, { ETag: etag }).end()
          return
        }
        res.writeHead(200, {
          ETag: etag,
          'Content-Type': contentType(abs),
          'Content-Length': st.size,
          'Last-Modified': st.mtime.toUTCString(),
          'Content-Security-Policy': "sandbox; default-src 'none'",
        })
        if (req.method === 'HEAD') res.end()
        else createReadStream(abs).pipe(res)
        return
      }
      case 'PROPFIND': {
        const depth = req.headers.depth ?? 'infinity'
        if (depth !== '0' && depth !== '1') throw new HttpError(403, 'Depth: infinity не поддерживается')
        req.resume()
        const st = await statOrNull(abs)
        if (!st) throw new HttpError(404)
        const entries = [await propEntry(parts, abs, st)]
        if (depth === '1' && st.isDirectory()) {
          for (const c of await children(abs)) entries.push(await propEntry([...parts, c.name], c.abs, c.st))
        }
        const body = `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }).end(body)
        return
      }
      case 'PUT': {
        if (!parts.length) throw new HttpError(405)
        const body = await readBody(req)
        const { status, etag } = await exclusive(async () => {
          const st = await statOrNull(abs)
          if (st?.isDirectory()) throw new HttpError(409, 'Это папка')
          checkPreconditions(req, st ? await etagOf(abs, st) : null)
          await writeAtomic(abs, body)
          const etag = etagOfBuffer(body)
          etags.set(abs, { key: statKey(await fs.stat(abs)), etag })
          return { status: st ? 204 : 201, etag }
        })
        res.writeHead(status, { ETag: etag, 'Content-Length': 0 }).end()
        notifyChange()
        return
      }
      case 'DELETE': {
        if (!parts.length) throw new HttpError(403, 'Корень удалить нельзя')
        req.resume()
        await exclusive(async () => {
          const st = await statOrNull(abs)
          if (!st) throw new HttpError(404)
          if (st.isFile()) checkPreconditions(req, await etagOf(abs, st))
          await fs.rm(abs, { recursive: true, force: true })
          forgetEtags(abs)
          // синхронизация удаляет файлы по одному; опустевшие папки (предмет ушёл в корзину) убираем следом.
          // rmdir не трогает непустую папку — файл, который кто-то успел туда положить, не пропадёт
          if (req.headers['x-typos-prune']) {
            for (let dir = path.dirname(abs); dir.startsWith(rootReal + path.sep); dir = path.dirname(dir)) {
              if (
                !(await fs.rmdir(dir).then(
                  () => true,
                  () => false,
                ))
              )
                break
            }
          }
        })
        res.writeHead(204).end()
        notifyChange()
        return
      }
      case 'MKCOL': {
        if (!parts.length) throw new HttpError(405)
        if ((await readBody(req)).length) throw new HttpError(415)
        await exclusive(async () => {
          if (await statOrNull(abs)) throw new HttpError(405, 'Уже существует')
          await fs.mkdir(abs, { recursive: true })
        })
        res.writeHead(201, { 'Content-Length': 0 }).end()
        notifyChange()
        return
      }
      case 'MOVE': {
        req.resume()
        const destination = req.headers.destination
        if (typeof destination !== 'string') throw new HttpError(400, 'Нет заголовка Destination')
        const destPath = new URL(destination, 'http://x').pathname
        const at = destPath.indexOf(`${FILES}/`)
        if (at < 0) throw new HttpError(400, 'Destination вне /files/')
        const destParts = vaultParts(destPath.slice(at))
        if (!parts.length || !destParts.length) throw new HttpError(403)
        if (destParts.length > parts.length && parts.every((p, i) => destParts[i] === p))
          throw new HttpError(403, 'Нельзя переместить папку в саму себя')
        const destAbs = await resolve(destParts)
        const overwrite = String(req.headers.overwrite ?? 'T').toUpperCase() !== 'F'
        const status = await exclusive(async () => {
          const st = await statOrNull(abs)
          if (!st) throw new HttpError(404)
          if (st.isFile()) checkPreconditions(req, await etagOf(abs, st))
          const destSt = await statOrNull(destAbs)
          // «Note.md» → «note.md» на диске без учёта регистра — это тот же файл, не конфликт
          const sameFile = destSt && destSt.ino === st.ino && destSt.dev === st.dev
          if (destSt && !sameFile) {
            if (!overwrite) throw new HttpError(412, 'Уже существует')
            await fs.rm(destAbs, { recursive: true, force: true })
            forgetEtags(destAbs)
          }
          await fs.mkdir(path.dirname(destAbs), { recursive: true })
          await fs.rename(abs, destAbs)
          forgetEtags(abs)
          return destSt && !sameFile ? 204 : 201
        })
        res.writeHead(status, { 'Content-Length': 0 }).end()
        notifyChange()
        return
      }
      default:
        throw new HttpError(405)
    }
  }

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  const handle = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const origin = req.headers.origin
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    // ключ идёт в заголовке, не в cookie, — чужая страница без ключа ничего не получит, поэтому по умолчанию пускаем любой адрес приложения
    if (origin && (!origins.length || origins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Expose-Headers', 'ETag, DAV')
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': METHODS,
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '7200',
      })
      res.end()
      return
    }
    // страница для проверки сертификата: открыл в браузере, принял — можно возвращаться в TYPOS
    if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      const page =
        '<!doctype html><meta charset="utf-8"><title>TYPOS storage</title><p>Сервер хранения TYPOS работает. Можно вернуться в приложение.</p>'
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : page)
      return
    }
    const isDav = url.pathname === FILES || url.pathname.startsWith(`${FILES}/`)
    if (req.method === 'OPTIONS' && isDav) {
      res.writeHead(200, { DAV: '1', Allow: METHODS, 'Content-Length': 0 }).end()
      return
    }

    const ip = clientIp(req)
    const now = Date.now()
    const f = failures.get(ip)
    if (f && f.until > now) throw new HttpError(429, 'Слишком много неверных ключей, подожди минуту')
    const device = await authenticate(req)
    if (!device) {
      const fails = f && now - f.last < 60_000 ? f.fails + 1 : 1
      failures.set(ip, { fails, last: now, until: fails >= 10 ? now + 60_000 : 0 })
      log(`неверный ключ с ${ip}`)
      // без Origin — это файловый менеджер, ему нужен запрос пароля; браузеру окно логина не показываем
      if (!origin) res.setHeader('WWW-Authenticate', 'Basic realm="TYPOS", charset="UTF-8"')
      throw new HttpError(401, 'Нужен ключ устройства')
    }
    failures.delete(ip)
    const today = new Date().toISOString().slice(0, 10)
    if (seen[device] !== today) {
      seen[device] = today
      seenDirty = true
    }

    if (url.pathname === '/.typos/info' && req.method === 'GET') {
      const s = await currentState()
      const body = JSON.stringify({ protocol: PROTOCOL, name: s.name, vaultId: s.vaultId, device })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(body)
      return
    }
    if (url.pathname === '/.typos/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' })
      res.write(`event: hello\ndata: ${JSON.stringify({ vaultId: (await currentState()).vaultId })}\n\n`)
      const stream = { res, device }
      streams.add(stream)
      req.on('close', () => streams.delete(stream))
      return
    }
    if (url.pathname === '/.typos/manifest' && req.method === 'GET') {
      const body = JSON.stringify(await manifest())
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(body)
      return
    }
    if (isDav) return dav(req, res, vaultParts(url.pathname))
    throw new HttpError(404)
  }

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  const listener = (req, res) => {
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500
      if (status === 500) log(`${req.method} ${req.url}: ${e?.stack ?? e}`)
      if (res.headersSent) return void res.destroy()
      const body = status === 500 ? 'Внутренняя ошибка сервера' : e.message
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body)
    })
  }

  const tls = Boolean(opts.cert && opts.key)
  const server = tls
    ? https.createServer(
        { cert: await fs.readFile(/** @type {string} */ (opts.cert)), key: await fs.readFile(/** @type {string} */ (opts.key)) },
        listener,
      )
    : http.createServer(listener)
  const host = opts.host ?? '0.0.0.0'
  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(opts.port ?? DEFAULT_PORT, host, () => done(undefined))
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? DEFAULT_PORT)

  // команда link без флагов строит ссылку на тот же адрес
  /** @type {Listen} */
  const listen = { port, host, tls, ...(opts.publicUrl ? { publicUrl: opts.publicUrl } : {}) }
  if (JSON.stringify(state.listen) !== JSON.stringify(listen)) {
    state = { ...state, listen }
    await writeJson(statePath(root), state)
    stateMtime = (await fs.stat(statePath(root))).mtimeMs
  }

  return {
    port,
    root,
    get state() {
      return state
    },
    targets: () => connectionTargets(listen),
    async close() {
      clearInterval(housekeeping)
      clearInterval(heartbeat)
      clearTimeout(changeTimer)
      watcher?.close()
      for (const s of streams) s.res.end('event: shutdown\ndata: {}\n\n')
      await flushSeen()
      server.closeAllConnections?.()
      await new Promise((done) => server.close(() => done(undefined)))
    },
  }
}

// ---------- командная строка ----------

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */
  const positional = []
  /** @type {Record<string, string>} */
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) positional.push(a)
    else if (a.includes('=')) flags[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1)
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i]
    else flags[a.slice(2)] = 'true'
  }
  return { positional, flags }
}

/**
 * Числовой флаг; неверное значение — ошибка, а не NaN (с NaN предел размера молча пропускал пустые файлы).
 * @param {Record<string, string>} flags @param {string} name @param {number} min @param {number} max
 */
function numberFlag(flags, name, min, max) {
  if (flags[name] === undefined) return undefined
  const n = Number(flags[name])
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name}: нужно число от ${min} до ${max}, а не «${flags[name]}»`)
  return n
}

const HELP = `Сервер хранения TYPOS

  node typos-server.mjs [serve] --dir <папка>   запустить сервер и показать ссылку
  node typos-server.mjs link [устройство]      показать ссылку (для нового устройства — завести ему ключ)
  node typos-server.mjs rotate <устройство>    новый ключ устройству, старая ссылка перестанет работать
  node typos-server.mjs devices                устройства и когда заходили
  node typos-server.mjs revoke <устройство>    отключить устройство

  Все ссылки открывают одно хранилище. Отдельные устройства нужны, только чтобы отключать их по одному.

  --dir <папка>         vault (или переменная TYPOS_VAULT)
  --port <порт>         по умолчанию ${DEFAULT_PORT}
  --host <адрес>        по умолчанию 0.0.0.0 (этот компьютер и вся сеть); 127.0.0.1 — только этот компьютер
  --name <имя>          как хранилище называется в приложении
  --cert, --key <файл>  HTTPS (нужен, если приложение открыто по https)
  --public-url <url>    внешний адрес, если сервер за прокси: https://notes.example.com
                        (тогда адрес клиента берётся из X-Forwarded-For от прокси на этом же компьютере)
  --origin <url,...>    пускать только эти адреса приложения (по умолчанию любые)
  --max-size <МБ>       предел размера файла, по умолчанию 50
  --no-link             не печатать ссылку при запуске (без терминала, например в systemd, она и так не печатается)
  --quiet               не писать в консоль неверные ключи и ошибки`

/**
 * @param {ServerState} state @param {string} token @param {{ label: string, base: string }[]} targets
 * @param {string} dir @param {string} device
 */
function printLinks(state, token, targets, dir, device) {
  console.log('\nСсылка подключения — вставь в TYPOS: «Хранилище» → «Сервер хранения».')
  if (targets.length > 1) console.log('Бери ту, что подходит к месту, где открыт TYPOS:')
  for (const t of targets) {
    console.log(`\n  TYPOS ${t.label}:`)
    console.log(`  ${buildLink({ base: t.base, token, name: state.name, vaultId: state.vaultId })}`)
  }
  const again = `node typos-server.mjs link${device === DEFAULT_DEVICE ? '' : ` ${device}`} --dir ${JSON.stringify(dir)}`
  console.log(`\nСсылка — это ключ: не публикуй её. Показать снова: ${again}`)
}

/** @param {Record<string, string>} flags @param {Listen | undefined} saved @returns {Listen} */
const listenFromFlags = (flags, saved) => ({
  ...(saved ?? { port: DEFAULT_PORT, host: '0.0.0.0', tls: false }),
  ...(flags.port ? { port: /** @type {number} */ (numberFlag(flags, 'port', 1, 65535)) } : {}),
  ...(flags.host ? { host: flags.host } : {}),
  ...(flags['public-url'] ? { publicUrl: flags['public-url'] } : {}),
})

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const command = positional[0] ?? 'serve'
  if (command === 'help' || flags.help) return console.log(HELP)
  const dir = flags.dir ?? process.env.TYPOS_VAULT
  if (!dir) throw new Error('Укажи папку: --dir ./vault (или TYPOS_VAULT). Справка: --help')
  const root = path.resolve(dir)

  if (command === 'serve') {
    const maxSizeMb = numberFlag(flags, 'max-size', 1, 4096)
    const srv = await startServer({
      dir: root,
      port: numberFlag(flags, 'port', 0, 65535),
      host: flags.host,
      name: flags.name,
      publicUrl: flags['public-url'],
      cert: flags.cert,
      key: flags.key,
      origins: flags.origin
        ?.split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
      maxSize: maxSizeMb === undefined ? undefined : maxSizeMb * 1024 * 1024,
      log: flags.quiet ? undefined : (line) => console.error(`[${new Date().toISOString()}] ${line}`),
    })
    const listen = /** @type {Listen} */ (srv.state.listen)
    const everywhere = listen.host === '0.0.0.0' || listen.host === '::'
    console.log(`TYPOS storage «${srv.state.name}» запущен`)
    console.log(`  папка:  ${root}`)
    console.log(`  доступ: ${everywhere ? 'этот компьютер и вся сеть' : listen.host} · порт ${srv.port}${listen.tls ? ' · HTTPS' : ''}`)
    // первый запуск — заводим ключ; дальше показываем тот же
    const hasDefault = srv.state.devices.some((d) => d.name === DEFAULT_DEVICE) || !srv.state.devices.length
    if (!hasDefault)
      console.log(`\nОбщего ключа нет (отозван). Ссылка для устройства: node typos-server.mjs link <имя> --dir ${JSON.stringify(dir)}`)
    else if (flags['no-link'] || !process.stdout.isTTY)
      console.log(`\nСсылка подключения: node typos-server.mjs link --dir ${JSON.stringify(dir)}`)
    else {
      const { state, token } = await deviceKey(root)
      printLinks(state, token, srv.targets(), dir, DEFAULT_DEVICE)
    }
    const others = srv.state.devices.filter((d) => d.name !== DEFAULT_DEVICE)
    if (others.length) console.log(`Отдельные устройства: ${others.map((d) => d.name).join(', ')}`)
    const stop = async () => {
      await srv.close()
      process.exit(0)
    }
    // once: второй Ctrl+C завершает сразу, не дожидаясь закрытия
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    return
  }

  if (command === 'link') {
    const device = positional[1] ?? DEFAULT_DEVICE
    const { state, token, created } = await deviceKey(root, device)
    if (created && device !== DEFAULT_DEVICE) console.log(`Устройству «${device}» заведён отдельный ключ. Отключить: revoke ${device}`)
    printLinks(state, token, connectionTargets(listenFromFlags(flags, state.listen)), dir, device)
    return
  }

  if (command === 'rotate') {
    const device = positional[1]
    if (!device) throw new Error('Какому устройству новый ключ? rotate <имя> (общая ссылка — rotate default)')
    const { state, token } = await rotateDevice(root, device)
    console.log(`Устройству «${device}» выдан новый ключ — старая ссылка больше не работает.`)
    printLinks(state, token, connectionTargets(listenFromFlags(flags, state.listen)), dir, device)
    return
  }

  if (command === 'devices') {
    const state = await loadState(root)
    if (!state?.devices.length) return console.log('Устройств нет. Добавить: link <имя>')
    /** @type {Record<string, string>} */
    const seen = await fs.readFile(seenPath(root), 'utf8').then(JSON.parse, () => ({}))
    for (const d of state.devices)
      console.log(`${d.name.padEnd(20)} добавлено ${d.created.slice(0, 10)} · заходило ${seen[d.name] ?? 'ещё нет'}`)
    return
  }

  if (command === 'revoke') {
    const device = positional[1]
    if (!device) throw new Error('Какое устройство отключить? revoke <имя>')
    console.log((await revokeDevice(root, device)) ? `«${device}» отключено.` : `Нет устройства «${device}».`)
    return
  }

  throw new Error(`Неизвестная команда: ${command}. Справка: --help`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
