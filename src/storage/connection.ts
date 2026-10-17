import { create } from 'zustand'
import type { RemoteAdapter } from './remoteAdapter'

/**
 * Связь с сервером хранения. local — сервер не подключён (браузер, папка).
 * Правки всё равно идут в локальную копию; связь решает только, когда они уйдут на сервер.
 */
export type ConnectionStatus = 'local' | 'connecting' | 'online' | 'offline' | 'revoked'

interface ConnectionState {
  status: ConnectionStatus
  /** Когда следующая попытка переподключиться (offline). */
  retryAt?: number
  /** Попробовать прямо сейчас. */
  retry: () => void
}

export const useConnection = create<ConnectionState>(() => ({ status: 'local', retry: () => {} }))

export interface MonitorOptions {
  /** Сколько ждать пульса сервера (он шлёт его каждые 10 с). */
  idleMs?: number
  /** Сколько ждать ответа при подключении: пропавшая сеть иначе держит запрос минутами. */
  connectMs?: number
  /** Паузы между попытками переподключения. */
  retryMs?: number[]
  onChange?: (status: ConnectionStatus, prev: ConnectionStatus) => void
  /** Сервер сообщил, что файлы поменялись (другое устройство, правка в папке). */
  onServerChange?: () => void
}

/** Следит за связью, пока открыт поток событий сервера. Возвращает «остановить». */
export function monitorConnection(adapter: RemoteAdapter, opts: MonitorOptions = {}): () => void {
  const idleMs = opts.idleMs ?? 25_000
  const connectMs = opts.connectMs ?? 5000
  const retryMs = opts.retryMs ?? [1000, 2000, 5000, 10_000]
  let stopped = false
  let current: AbortController | null = null
  let wake: (() => void) | null = null

  const set = (status: ConnectionStatus, retryAt?: number) => {
    const prev = useConnection.getState().status
    useConnection.setState({ status, retryAt })
    if (prev !== status) opts.onChange?.(status, prev)
  }
  const kick = () => wake?.()
  const onVisible = () => document.visibilityState === 'visible' && kick()
  window.addEventListener('online', kick)
  document.addEventListener('visibilitychange', onVisible)
  // запрос упал — поток, скорее всего, тоже мёртв: рвём его и переподключаемся, это и покажет правду
  adapter.onProblem = () => current?.abort()
  useConnection.setState({ status: 'connecting', retryAt: undefined, retry: kick })

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        wake = null
        resolve()
      }
      const timer = setTimeout(done, ms)
      wake = done
    })

  void (async () => {
    let attempt = 0
    // связь только что была — одна мгновенная перепроверка, чтобы случайный сбой не мигал «нет связи»
    let recheck = false
    while (!stopped) {
      const ctrl = (current = new AbortController())
      const connectTimer = setTimeout(() => ctrl.abort(), connectMs)
      try {
        const end = await adapter.events(
          ctrl.signal,
          idleMs,
          () => {
            clearTimeout(connectTimer)
            attempt = 0
            recheck = true
            set('online')
          },
          opts.onServerChange,
        )
        if (end === 'revoked') return set('revoked')
        // пульс пропал — сеть, скорее всего, пропала тоже; перепроверка ничего не даст
        if (end === 'idle') recheck = false
      } catch {
        // нет сети или сервер не отвечает — ниже переподключение
      } finally {
        clearTimeout(connectTimer)
      }
      if (stopped) return
      if (recheck) {
        recheck = false
        continue
      }
      const delay = retryMs[Math.min(attempt++, retryMs.length - 1)]
      set('offline', Date.now() + delay)
      await sleep(delay)
    }
  })()

  return () => {
    stopped = true
    current?.abort()
    wake?.()
    window.removeEventListener('online', kick)
    document.removeEventListener('visibilitychange', onVisible)
    adapter.onProblem = undefined
    useConnection.setState({ status: 'local', retryAt: undefined, retry: () => {} })
  }
}
