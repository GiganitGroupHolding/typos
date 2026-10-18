/**
 * Ссылка подключения, которую печатает сервер хранения (server/typos-server.mjs):
 * typos://host:port/путь?n=имя&id=vaultId&k=ключ[&tls=1]
 */

export interface RemoteConfig {
  /** Адрес сервера без слэша в конце: «http://192.168.1.10:8787». */
  url: string
  /** Ключ этого устройства. */
  token: string
  /** Имя хранилища для интерфейса. */
  name: string
  /** id хранилища — ссылка от другого сервера не подменит его молча. */
  vaultId: string
}

export function parseRemoteLink(text: string): RemoteConfig {
  const raw = text.trim()
  if (!/^typos:\/\//i.test(raw)) throw new Error('Это не ссылка TYPOS — она начинается с typos://')
  let u: URL
  try {
    // свои схемы браузеры разбирают по-разному, поэтому разбираем как http
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

/** Страница по https не может ходить на http-сервер — браузер блокирует такие запросы. */
export const blockedAsMixedContent = (config: RemoteConfig, pageProtocol = globalThis.location?.protocol) =>
  pageProtocol === 'https:' && config.url.startsWith('http:')

export const MIXED_CONTENT_HINT =
  'Приложение открыто по https, а сервер — по http: браузер такое блокирует. Запусти сервер с --cert/--key или открой приложение по http.'
