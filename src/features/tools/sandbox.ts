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

/**
 * Ставит CSP самым первым тегом документа: раньше него может стоять только doctype, поэтому ни один скрипт тулзы
 * не выполнится до политики. Искать <head> нельзя: «<head>» в комментарии или строке уводил meta-тег из документа.
 * Парсер HTML сам создаёт <head> для meta перед <html>, а поздние <html>/<head> тулзы лишь сливаются с ним.
 */
export function withCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${TOOL_CSP}">`
  const source = html.replace(/^\uFEFF/, '')
  // doctype оставляем первым: без него документ перешёл бы в режим совместимости и свёрстался иначе
  const doctype = source.match(/^\s*<!doctype\b[^>]*>/i)?.[0] ?? ''
  return `${doctype}${meta}${source.slice(doctype.length)}`
}

/** Белый список сообщений приложение → тулза. */
export type ToolMessage = { type: 'theme'; value: 'light' | 'dark' }
