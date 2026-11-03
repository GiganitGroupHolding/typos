export interface RemoteConfig {
  url: string

  token: string

  name: string

  vaultId: string
}

export function parseRemoteLink(text: string): RemoteConfig {
  const raw = text.trim()
  if (!/^typos:\/\//i.test(raw)) throw new Error("Ссылка TYPOS должна начинаться с typos://")
  let u: URL
  try {
    u = new URL(raw.replace(/^typos:\/\//i, "http://"))
  } catch {
    throw new Error("Ссылка повреждена. Скопируй её целиком.")
  }
  const token = u.searchParams.get("k")
  if (!u.host || !token) throw new Error("В ссылке нет адреса или ключа. Скопируй её целиком.")
  const scheme = u.searchParams.get("tls") === "1" ? "https" : "http"
  return {
    url: `${scheme}://${u.host}${u.pathname.replace(/\/+$/, "")}`,
    token,
    name: u.searchParams.get("n") || u.hostname,
    vaultId: u.searchParams.get("id") ?? "",
  }
}

export const blockedAsMixedContent = (config: RemoteConfig, pageProtocol = globalThis.location?.protocol) =>
  pageProtocol === "https:" && config.url.startsWith("http:")

export const MIXED_CONTENT_HINT = "Серверу нужен HTTPS. Используй --cert/--key или открой приложение по HTTP."
