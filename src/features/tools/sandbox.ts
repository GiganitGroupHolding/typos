/**
 * Изоляция HTML-тулз (артефактов).
 * iframe: sandbox без allow-same-origin → opaque origin: нет доступа к DOM приложения,
 * localStorage/IndexedDB, файлам vault. Плюс CSP: никакой сети (connect-src 'none'),
 * скрипты — inline и популярные CDN (артефакты Claude их используют).
 */

export const TOOL_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups'

const CDN = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com'

export const TOOL_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDN}`,
  `style-src 'unsafe-inline' ${CDN} https://fonts.googleapis.com`,
  `font-src data: ${CDN} https://fonts.gstatic.com`,
  'img-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** Вставляет CSP первым элементом <head>, чтобы он действовал до любых скриптов артефакта. */
export function withCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${TOOL_CSP}">`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${meta}</head>`)
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`
}

/** Белый список сообщений приложение → тулза. */
export type ToolMessage = { type: 'theme'; value: 'light' | 'dark' }
