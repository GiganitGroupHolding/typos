import MiniSearch from "minisearch"
import { boardText } from "@/features/boards/model"
import type { Board, Note, Pin, Subject, Tool } from "@/types"

export type HitKind = "note" | "pin" | "tool" | "board" | "subject"

export interface SearchDoc {
  id: string
  kind: HitKind
  refId: string
  subjectId: string
  title: string
  text: string
}

export interface SearchHit extends SearchDoc {
  score: number
  terms: string[]
}

export const normalize = (s: string) => s.toLowerCase().replaceAll("ё", "е")

const tokenize = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export function plainText(md: string): string {
  return md
    .replace(/<\/?(span|mark|u|s|b|i|em|strong|sub|sup)\b[^>]*>/gi, "")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/\+\+([^+]+)\+\+/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+(\[[ x]]\s+)?/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\$\$|\$/g, " ")
    .replace(/\\([a-zA-Z]+)/g, " $1 ")
    .replace(/[*_`~{}^]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function buildDocs(data: { subjects: Subject[]; notes: Note[]; pins: Pin[]; tools: Tool[]; boards?: Board[] }): SearchDoc[] {
  return [
    ...data.subjects.map((s) => ({
      id: `subject:${s.id}`,
      kind: "subject" as const,
      refId: s.id,
      subjectId: s.id,
      title: s.name,
      text: "",
    })),
    ...data.notes.map((n) => ({
      id: `note:${n.id}`,
      kind: "note" as const,
      refId: n.id,
      subjectId: n.subjectId,
      title: n.title || "Без названия",
      text: plainText(n.mapText ? `${n.body}\n${n.mapText}` : n.body),
    })),
    ...data.pins.map((p) => ({
      id: `pin:${p.id}`,
      kind: "pin" as const,
      refId: p.id,
      subjectId: p.subjectId,
      title: p.title,
      text: plainText([p.tex ? `$${p.tex}$` : "", p.text ?? "", p.url ?? ""].join(" ")),
    })),
    ...data.tools.map((t) => ({ id: `tool:${t.id}`, kind: "tool" as const, refId: t.id, subjectId: t.subjectId, title: t.name, text: "" })),
    ...(data.boards ?? []).map((b) => ({
      id: `board:${b.id}`,
      kind: "board" as const,
      refId: b.id,
      subjectId: b.subjectId,
      title: b.name,
      text: plainText(boardText(b.data)),
    })),
  ]
}

export function createIndex(docs: SearchDoc[]) {
  const ms = new MiniSearch<SearchDoc>({
    fields: ["title", "text"],
    storeFields: ["kind", "refId", "subjectId", "title", "text"],
    tokenize,
    processTerm: (t) => normalize(t),
    searchOptions: {
      boost: { title: 3 },
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: "AND",
    },
  })
  ms.addAll(docs)
  return ms
}

export function search(ms: MiniSearch<SearchDoc>, query: string, limit = 30): SearchHit[] {
  if (!query.trim()) return []
  return ms
    .search(query)
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      kind: r.kind,
      refId: r.refId,
      subjectId: r.subjectId,
      title: r.title,
      text: r.text,
      score: r.score,
      terms: r.terms,
    }))
}

export function snippet(text: string, terms: string[], radius = 48): { text: string; hit: boolean }[] {
  if (!text) return []
  const norm = normalize(text)
  let at = -1
  let len = 0
  for (const t of terms) {
    const i = norm.indexOf(t)
    if (i !== -1 && (at === -1 || i < at)) {
      at = i
      len = t.length
    }
  }
  if (at === -1) return [{ text: text.slice(0, radius * 2) + (text.length > radius * 2 ? "…" : ""), hit: false }]
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + len + radius)
  return [
    { text: (start > 0 ? "…" : "") + text.slice(start, at), hit: false },
    { text: text.slice(at, at + len), hit: true },
    { text: text.slice(at + len, end) + (end < text.length ? "…" : ""), hit: false },
  ]
}
