export const TOOL_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups"

const CDN = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com"

export const TOOL_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDN}`,
  `style-src 'unsafe-inline' ${CDN} https://fonts.googleapis.com`,
  `font-src data: ${CDN} https://fonts.gstatic.com`,
  "img-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

export function withCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${TOOL_CSP}">`
  const source = html.replace(/^\uFEFF/, "")

  const doctype = source.match(/^\s*<!doctype\b[^>]*>/i)?.[0] ?? ""
  return `${doctype}${meta}${source.slice(doctype.length)}`
}

export type ToolMessage = { type: "theme"; value: "light" | "dark" }
