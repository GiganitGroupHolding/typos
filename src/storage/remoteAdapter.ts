import { createStore, del, get, set } from 'idb-keyval'
import type { Entry, VaultAdapter } from './VaultAdapter'
import { blockedAsMixedContent, type RemoteConfig } from './remoteLink'

/**
 * Vault на сервере хранения TYPOS (server/typos-server.mjs). Файлы — подмножество WebDAV под /files/,
 * ключ устройства — в заголовке Authorization. Каждый вызов идёт в сеть.
 * Приложение работает не с ним напрямую, а с локальной копией (syncedAdapter); этот класс — транспорт синхронизации.
 */

export class RemoteError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/** Весь vault на сервере одним списком: путь → ETag. */
export interface Manifest {
  files: Record<string, { etag: string; size: number; mtime: string }>
  dirs: string[]
}

export interface RemoteInfo {
  protocol: string
  name: string
  vaultId: string
  device: string
}

const DAV = 'DAV:'

/** Ответ PROPFIND Depth: 1 → содержимое папки. Сама папка — запись с самым коротким путём. */
export function parseListing(xml: string): Entry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const items = [...doc.getElementsByTagNameNS(DAV, 'response')].map((r) => {
    const href = r.getElementsByTagNameNS(DAV, 'href')[0]?.textContent ?? ''
    const segments = new URL(href, 'http://x').pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const isDir = r.getElementsByTagNameNS(DAV, 'collection').length > 0
    return { segments, isDir }
  })
  if (!items.length) return []
  const depth = Math.min(...items.map((i) => i.segments.length))
  return items
    .filter((i) => i.segments.length === depth + 1)
    .map((i) => ({ name: i.segments.at(-1)!, kind: i.isDir ? 'dir' : 'file' }))
}

/** Чем закончился поток событий: сервер закрыл его (остановлен), замолчал дольше пульса или отозвал ключ. */
export type EventsEnd = 'ended' | 'idle' | 'revoked'

export class RemoteAdapter implements VaultAdapter {
  readonly kind = 'remote' as const
  readonly label: string
  readonly config: RemoteConfig
  /** Запрос не дошёл до сервера или ключ не приняли — монитор связи перепроверит её сразу, не дожидаясь пульса. */
  onProblem?: (kind: 'unreachable' | 'unauthorized') => void

  constructor(config: RemoteConfig) {
    this.config = config
    this.label = config.name
  }

  private fileUrl(path: string, dir = false) {
    const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    return `${this.config.url}/files/${encoded}${dir && encoded ? '/' : ''}`
  }

  private unreachable() {
    const { url } = this.config
    const host = new URL(url).host
    if (blockedAsMixedContent(this.config))
      return 'Приложение открыто по https, а сервер — по http: браузер такое блокирует. Запусти сервер с --cert/--key или открой приложение по http.'
    if (url.startsWith('https:'))
      return `Сервер ${host} не отвечает. Если у него самоподписанный сертификат — открой ${url} в браузере один раз и прими его.`
    return `Сервер ${host} не отвечает. Проверь, что он запущен и это устройство в той же сети.`
  }

  /** ok — статусы, которые не ошибка (например, 404 у чтения: файла нет). */
  private async request(url: string, init: RequestInit & { headers?: Record<string, string> } = {}, ok: number[] = []) {
    let res: Response
    try {
      res = await fetch(url, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${this.config.token}`, ...init.headers } })
    } catch {
      this.onProblem?.('unreachable')
      throw new RemoteError(this.unreachable())
    }
    if (res.status === 401) this.onProblem?.('unauthorized')
    if (res.status === 401) throw new RemoteError('Сервер не принял ключ — устройство отключили или выдали ему новый. Получи ссылку командой link.', 401)
    if (!res.ok && !ok.includes(res.status)) {
      const text = await res.text().catch(() => '')
      throw new RemoteError(`Сервер ответил ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status)
    }
    return res
  }

  /** Проверка связи и ключа. */
  async info(): Promise<RemoteInfo> {
    const res = await this.request(`${this.config.url}/.typos/info`, {}, [404])
    const info = res.status === 404 ? null : ((await res.json().catch(() => null)) as RemoteInfo | null)
    if (!info?.protocol?.startsWith('typos-storage/')) throw new RemoteError('По этому адресу не сервер хранения TYPOS')
    return info
  }

  /**
   * Держит открытым поток /.typos/events. onOpen — сервер поздоровался (event: hello). Если за idleMs не пришло ничего
   * (даже пульса), связь считается потерянной. Нет сети — бросает.
   */
  async events(signal: AbortSignal, idleMs: number, onOpen: () => void, onChange?: () => void): Promise<EventsEnd> {
    const res = await fetch(`${this.config.url}/.typos/events`, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${this.config.token}` } })
    if (res.status === 401) return 'revoked'
    if (!res.ok || !res.body) throw new RemoteError(`Сервер ответил ${res.status}`, res.status)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let idle = false
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        idle = true
        void reader.cancel().catch(() => {})
      }, idleMs)
    }
    try {
      arm()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return idle ? 'idle' : 'ended'
        arm()
        buffer += decoder.decode(value, { stream: true })
        for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          if (/^event: revoked$/m.test(block)) return 'revoked'
          if (/^event: hello$/m.test(block)) onOpen()
          if (/^event: change$/m.test(block)) onChange?.()
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async manifest(): Promise<Manifest> {
    return (await this.request(`${this.config.url}/.typos/manifest`)).json()
  }

  /** Файл и его ETag; null — файла нет. */
  async get(path: string): Promise<{ blob: Blob; etag: string } | null> {
    const res = await this.request(this.fileUrl(path), {}, [404])
    if (res.status === 404) return null
    return { blob: await res.blob(), etag: res.headers.get('ETag') ?? '' }
  }

  /** Запись с условием: ifMatch — только поверх этой версии, иначе — только если файла ещё нет. 'conflict' — условие не выполнено. */
  async put(path: string, blob: Blob, ifMatch?: string): Promise<{ etag: string } | 'conflict'> {
    const res = await this.request(
      this.fileUrl(path),
      {
        method: 'PUT',
        body: await blob.arrayBuffer(),
        headers: { 'Content-Type': blob.type || 'application/octet-stream', ...(ifMatch ? { 'If-Match': ifMatch } : { 'If-None-Match': '*' }) },
      },
      [412],
    )
    return res.status === 412 ? 'conflict' : { etag: res.headers.get('ETag') ?? '' }
  }

  /** Удаление этой версии файла; опустевшие папки над ним сервер убирает сам. 'conflict' — файл успели изменить. */
  async del(path: string, ifMatch?: string): Promise<'ok' | 'conflict'> {
    const headers: Record<string, string> = { 'X-Typos-Prune': '1', ...(ifMatch ? { 'If-Match': ifMatch } : {}) }
    const res = await this.request(this.fileUrl(path), { method: 'DELETE', headers }, [404, 412])
    return res.status === 412 ? 'conflict' : 'ok'
  }

  async list(dir: string): Promise<Entry[]> {
    const res = await this.request(this.fileUrl(dir, true), { method: 'PROPFIND', headers: { Depth: '1' } }, [404])
    return res.status === 404 ? [] : parseListing(await res.text())
  }

  async readText(path: string) {
    const res = await this.request(this.fileUrl(path), {}, [404])
    return res.status === 404 ? null : await res.text()
  }

  async readBlob(path: string) {
    const res = await this.request(this.fileUrl(path), {}, [404])
    return res.status === 404 ? null : await res.blob()
  }

  async writeText(path: string, text: string) {
    await this.request(this.fileUrl(path), { method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  async writeBlob(path: string, blob: Blob) {
    await this.request(this.fileUrl(path), { method: 'PUT', body: await blob.arrayBuffer(), headers: { 'Content-Type': blob.type || 'application/octet-stream' } })
  }

  async exists(path: string) {
    const res = await this.request(this.fileUrl(path), { method: 'PROPFIND', headers: { Depth: '0' } }, [404])
    return res.status !== 404
  }

  async remove(path: string) {
    await this.request(this.fileUrl(path), { method: 'DELETE' }, [404])
  }

  async move(from: string, to: string) {
    if (from === to) return
    const res = await this.request(this.fileUrl(from), { method: 'MOVE', headers: { Destination: this.fileUrl(to), Overwrite: 'F' } }, [412])
    if (res.status === 412) throw new Error(`Уже существует: ${to}`)
  }
}

// ---------- сохранённое подключение ----------

const settings = createStore('studynotes-settings', 'kv')
const REMOTE_KEY = 'remote'

export const loadRemoteConfig = () => get<RemoteConfig>(REMOTE_KEY, settings).catch(() => undefined)
export const saveRemoteConfig = (config: RemoteConfig) => set(REMOTE_KEY, config, settings)
export const forgetRemoteConfig = () => del(REMOTE_KEY, settings)
