import { del, get, set } from "idb-keyval"
import { blockedAsMixedContent, MIXED_CONTENT_HINT, type RemoteConfig } from "./remoteLink"
import { settingsStore } from "./settings"

export class RemoteError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

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

export type EventsEnd = "ended" | "idle" | "revoked"

export class RemoteAdapter {
  readonly config: RemoteConfig

  onProblem?: (kind: "unreachable" | "unauthorized") => void

  constructor(config: RemoteConfig) {
    this.config = config
  }

  protected fileUrl(path: string, dir = false) {
    const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/")
    return `${this.config.url}/files/${encoded}${dir && encoded ? "/" : ""}`
  }

  private unreachable() {
    const { url } = this.config
    const host = new URL(url).host
    if (blockedAsMixedContent(this.config)) return MIXED_CONTENT_HINT
    if (url.startsWith("https:")) return `Сервер ${host} не отвечает. Проверь сертификат в браузере: ${url}.`
    return `Сервер ${host} не отвечает. Проверь подключение.`
  }

  protected async request(url: string, init: RequestInit & { headers?: Record<string, string> } = {}, ok: number[] = []) {
    let res: Response
    try {
      res = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${this.config.token}`, ...init.headers } })
    } catch {
      this.onProblem?.("unreachable")
      throw new RemoteError(this.unreachable())
    }
    if (res.status === 401) {
      this.onProblem?.("unauthorized")
      throw new RemoteError("Ключ недействителен. Получи новую ссылку командой link.", 401)
    }
    if (!res.ok && !ok.includes(res.status)) {
      const text = await res.text().catch(() => "")
      throw new RemoteError(`Сервер ответил ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, res.status)
    }
    return res
  }

  async info(): Promise<RemoteInfo> {
    const res = await this.request(`${this.config.url}/.typos/info`, {}, [404])
    const info = res.status === 404 ? null : ((await res.json().catch(() => null)) as RemoteInfo | null)

    if (!info?.protocol?.startsWith("typos-storage/")) throw new RemoteError("По этому адресу нет сервера хранения TYPOS", res.status)
    return info
  }

  async events(signal: AbortSignal, idleMs: number, onOpen: () => void, onChange?: () => void): Promise<EventsEnd> {
    const res = await fetch(`${this.config.url}/.typos/events`, {
      signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${this.config.token}` },
    })
    if (res.status === 401) return "revoked"
    if (!res.ok || !res.body) throw new RemoteError(`Сервер ответил ${res.status}`, res.status)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
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
        if (done) return idle ? "idle" : "ended"
        arm()
        buffer += decoder.decode(value, { stream: true })
        for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          if (/^event: revoked$/m.test(block)) return "revoked"
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

  async get(path: string): Promise<{ blob: Blob; etag: string } | null> {
    const res = await this.request(this.fileUrl(path), {}, [404])
    if (res.status === 404) return null
    return { blob: await res.blob(), etag: res.headers.get("ETag") ?? "" }
  }

  async put(path: string, blob: Blob, ifMatch?: string): Promise<{ etag: string } | "conflict"> {
    const res = await this.request(
      this.fileUrl(path),
      {
        method: "PUT",
        body: await blob.arrayBuffer(),
        headers: {
          "Content-Type": blob.type || "application/octet-stream",
          ...(ifMatch ? { "If-Match": ifMatch } : { "If-None-Match": "*" }),
        },
      },
      [412],
    )
    return res.status === 412 ? "conflict" : { etag: res.headers.get("ETag") ?? "" }
  }

  async del(path: string, ifMatch?: string): Promise<"ok" | "conflict"> {
    const headers: Record<string, string> = { "X-Typos-Prune": "1", ...(ifMatch ? { "If-Match": ifMatch } : {}) }
    const res = await this.request(this.fileUrl(path), { method: "DELETE", headers }, [404, 412])
    return res.status === 412 ? "conflict" : "ok"
  }
}

export async function checkRemote(config: RemoteConfig): Promise<RemoteInfo> {
  const info = await new RemoteAdapter(config).info()
  if (config.vaultId && info.vaultId !== config.vaultId) throw new Error("Ссылка от другого хранилища. Получи новую командой link.")
  return info
}

const REMOTE_KEY = "remote"

export const loadRemoteConfig = () => get<RemoteConfig>(REMOTE_KEY, settingsStore).catch(() => undefined)
export const saveRemoteConfig = (config: RemoteConfig) => set(REMOTE_KEY, config, settingsStore)
export const forgetRemoteConfig = () => del(REMOTE_KEY, settingsStore)
