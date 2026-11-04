import type { ToolKind } from "@/types"

export const NOTES_DIR = "Конспекты"
export const PINS_DIR = "Закреп"

export const MAPS_DIR = ".maps"
export const PROJECTS_DIR = "Проекты"
export const BOARDS_DIR = "Доски"

export const TOOLS_DIR = "Инструменты"

const KINDS: [RegExp, ToolKind][] = [
  [/^html?$/, "html"],
  [/^(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/, "image"],
  [/^pdf$/, "pdf"],
  [/^docx$/, "docx"],
  [/^pptx$/, "pptx"],
  [/^(xlsx|xls|xlsm|xlsb|csv|tsv)$/, "spreadsheet"],
  [/^(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|ini|css|js|ts|py|java|c|cpp|cs|go|rs|sql|tex)$/, "text"],
  [/^(mp4|webm|mov|m4v|ogv)$/, "video"],
  [/^(mp3|wav|ogg|m4a|flac|aac)$/, "audio"],
]

export const fileKind = (ext: string): ToolKind => KINDS.find(([re]) => re.test(ext.toLowerCase()))?.[1] ?? "other"
export const SUBJECT_META = "_subject.json"
export const SYSTEM_DIR = ".studynotes"
export const TRASH_DIR = `${SYSTEM_DIR}/trash`

export function genId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-2)
}

export interface Parsed {
  meta: Record<string, string>
  body: string
}

export function parseFrontmatter(text: string): Parsed {
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n")
  if (!src.startsWith("---\n")) return { meta: {}, body: src }
  const end = src.indexOf("\n---", 4)
  if (end === -1) return { meta: {}, body: src }
  const meta: Record<string, string> = {}
  for (const line of src.slice(4, end).split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.*)$/)
    if (m) meta[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2")
  }
  const after = src.slice(end + 4)
  return { meta, body: after.replace(/^[^\n]*\n/, "").replace(/^\n/, "") }
}

export function serializeFrontmatter(meta: Record<string, string>, body: string): string {
  const order = ["id", "created", "updated", "order"]
  const keys = [...order.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !order.includes(k))]
  const head = keys.map((k) => `${k}: ${meta[k]}`).join("\n")
  return `---\n${head}\n---\n\n${body.replace(/^\n+/, "")}`
}

export const sameBody = (x: string, y: string) => x.replace(/^\n+/, "").trimEnd() === y.replace(/^\n+/, "").trimEnd()

const TEX_SYMBOLS: Record<string, string> = {
  times: "×",
  cdot: "·",
  neq: "≠",
  ne: "≠",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  approx: "≈",
  pm: "±",
  to: "→",
  rightarrow: "→",
  Rightarrow: "⇒",
  infty: "∞",
  in: "∈",
  sum: "∑",
  prod: "∏",
  int: "∫",
  sqrt: "√",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  cup: "∪",
  cap: "∩",
  subset: "⊂",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  Sigma: "Σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  Omega: "Ω",
}

export function prettyTex(tex: string): string {
  return tex
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\(?:left|right|[bB]ig|qquad|quad|[,;!])/g, " ")
    .replace(/\\vec\s*/g, "")
    .replace(/\\([a-zA-Z]+)/g, (_m, name: string) => TEX_SYMBOLS[name] ?? name)
    .replace(/[{}^_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

const stripInline = (s: string) =>
  s
    .replace(/<\/?(span|mark|u|s|b|i|em|strong|sub|sup)\b[^>]*>/gi, "")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/\+\+([^+]+)\+\+/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\$([^$]+)\$/g, (_m, tex: string) => prettyTex(tex))
    .replace(/[*_`~]+/g, "")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()

function textLines(body: string): string[] {
  const out: string[] = []
  let fence: string | null = null
  for (const raw of body.split("\n")) {
    const line = raw.trim()
    if (fence) {
      if (line.startsWith(fence)) fence = null
      continue
    }
    if (line.startsWith("```")) {
      fence = "```"
      continue
    }
    if (line === "$$") {
      fence = "$$"
      continue
    }
    if (/^\$\$.*\$\$$/.test(line)) continue

    if (line.startsWith("|")) {
      if (/^[\s|:-]+$/.test(line)) continue
      out.push(
        line
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.trim())
          .filter(Boolean)
          .join(" · "),
      )
      continue
    }
    out.push(line)
  }
  return out
}

const plainLine = (l: string) => stripInline(l.replace(/&nbsp;| /g, " ").replace(/^#{1,6}\s+|^([-*+]|\d+\.)\s+(\[[ x]]\s+)?|^>\s*/g, ""))

const plainLines = (body: string) => textLines(body).map(plainLine).filter(Boolean)

export function extractTitle(body: string): string {
  return plainLines(body)[0] ?? ""
}

export function extractExcerpt(body: string, max = 140): string {
  const text = plainLines(body).slice(1).join(" ")
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function parsePinBody(body: string): { title: string; tex?: string; text?: string } {
  const title = extractTitle(body)
  const block = body.match(/\$\$\s*\n?([\s\S]+?)\n?\s*\$\$/)
  const content = body.replace(/^\s*#\s+[^\n]*(?:\n|$)/, "")
  const text = (block ? content.replace(block[0], "") : content).trim()
  return { title, tex: block?.[1].trim() || undefined, text: text || undefined }
}

export function serializePinBody(title: string, tex?: string, text?: string): string {
  return [`# ${title}`, tex ? `$$\n${tex}\n$$` : "", text ?? ""].filter(Boolean).join("\n\n") + "\n"
}
