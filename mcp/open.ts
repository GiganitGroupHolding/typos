import { existsSync, statSync } from 'node:fs'
import { DavAdapter } from '@/storage/davAdapter'
import { checkRemote, RemoteError } from '@/storage/remoteAdapter'
import { parseRemoteLink } from '@/storage/remoteLink'
import type { VaultAdapter } from '@/storage/VaultAdapter'
import { NodeFsAdapter } from './nodeAdapter'

/**
 * Хранилище MCP-сервера: папка на этом компьютере (--vault) или сервер хранения по ссылке (--link).
 * Флаги важнее переменных окружения STUDYNOTES_VAULT / STUDYNOTES_LINK.
 * warn — сообщения в stderr: stdout у MCP занят протоколом.
 */
export async function openVault(
  argv: string[],
  env: NodeJS.ProcessEnv,
  warn: (line: string) => void = console.error,
): Promise<VaultAdapter> {
  const flag = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const [vault, link] = [flag('--vault'), flag('--link')]
  if (vault && link) throw new Error('Укажи что-то одно: --vault (папка) или --link (сервер хранения)')
  const folder = vault ?? (link ? undefined : env.STUDYNOTES_VAULT)
  const remote = link ?? (vault ? undefined : env.STUDYNOTES_LINK)

  if (remote) {
    const config = parseRemoteLink(remote)
    try {
      const info = await checkRemote(config)
      // общий ключ нельзя отозвать у одного ИИ, не отключив остальные устройства
      if (info.device === 'default')
        warn('MCP работает с общим ключом default. Заведи ему отдельный на сервере хранения: link mcp — и подключи MCP по новой ссылке')
      return new DavAdapter({ ...config, name: info.name || config.name, vaultId: info.vaultId })
    } catch (e) {
      // сервер выключен — всё равно запускаемся: инструменты ответят понятной ошибкой, а заработают, когда он вернётся.
      // Чужое хранилище, неверный ключ, не тот адрес — сразу ошибка
      if (!(e instanceof RemoteError) || e.status !== undefined) throw e
      warn(`Сервер хранения пока недоступен: ${e.message}`)
      return new DavAdapter(config)
    }
  }
  if (!folder) throw new Error('Укажи хранилище: --vault "C:\\…\\conspects" (папка) или --link "typos://…" (сервер хранения)')
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`Нет такой папки: ${folder}`)
  return new NodeFsAdapter(folder)
}
