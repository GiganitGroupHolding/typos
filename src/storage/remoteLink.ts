export interface RemoteConfig {
  url: string

  token: string

  name: string

  vaultId: string
}

export function parseRemoteLink(text: string): RemoteConfig {
  const raw = text.trim()
  if (!/^typos:\/\//i.test(raw)) throw new Error('Это не ссылка TYPOS — она начинается с typos://')
  let u: URL
  try {
    u = new URL(raw.replace(/^typos:\/\//i, 'http://'))
  } catch {
    throw new Error('Ссылка повреждена — скопируй её из вывода сервера целиком')
  }
  const token = u.searchParams.get('k')
  if (!u.host || !token) throw new Error('В ссылке нет адреса или ключа — скопируй её из вывода сервера целиком')
  const scheme = u.searchParams.get('tls') === '1' ? 'https' : 'http'
  return {
    url: `${scheme}://${u.host}${u.pathname.replace(/\/+$/, '')}`,
    token,
    name: u.searchParams.get('n') || u.hostname,
    vaultId: u.searchParams.get('id') ?? '',
  }
}

export const blockedAsMixedContent = (config: RemoteConfig, pageProtocol = globalThis.location?.protocol) =>
  pageProtocol === 'https:' && config.url.startsWith('http:')

export const MIXED_CONTENT_HINT =
  'Приложение открыто по https, а сервер — по http: браузер такое блокирует. Запусти сервер с --cert/--key или открой приложение по http.'
