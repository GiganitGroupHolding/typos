import { promises as fs } from 'node:fs'
import path from 'node:path'
import katex from 'katex'
import sharp from 'sharp'
import { normalizeMarkdownMath } from '@/editor/texImport'
import { SUBJECT_COLOR_IDS } from '@/lib/subjectPalette'
import { joinPath, type VaultAdapter } from '@/storage/VaultAdapter'
import type { Note, Subject, SubjectColor, SubjectIcon, ToolIcon } from '@/types'
import { genId, NOTES_DIR } from '@/vault/format'
import * as repo from '@/vault/repo'

/**
 * Операции MCP над vault. Всё пишется через repo.ts — те же функции, что у приложения,
 * поэтому frontmatter, id, имена файлов и переименование по заголовку совпадают один в один.
 * Удаления нет: только корзина (.studynotes/trash), откуда приложение умеет вернуть.
 */

const MAX_IMAGE = 25 * 1024 * 1024
const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е').trim()

export type UpdateMode = 'replace' | 'append' | 'replace_section'

export class StudyVault {
  readonly a: VaultAdapter

  constructor(adapter: VaultAdapter) {
    this.a = adapter
  }

  private load = () => repo.loadVault(this.a)

  private subject(data: repo.VaultData, ref: string): Subject {
    const s = data.subjects.find((x) => x.id === ref) ?? data.subjects.find((x) => norm(x.name) === norm(ref))
    if (!s) throw new Error(`Нет предмета «${ref}». Есть: ${data.subjects.map((x) => x.name).join(', ') || 'пока ни одного'}`)
    return s
  }

  private note(data: repo.VaultData, id: string): Note {
    const n = data.notes.find((x) => x.id === id)
    if (!n) throw new Error(`Нет конспекта с id «${id}». Id — из get_subject или search.`)
    return n
  }

  // ---------- предметы ----------

  async listSubjects() {
    const d = await this.load()
    return d.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      icon: s.icon,
      notes: d.notes.filter((n) => n.subjectId === s.id).length,
      pins: d.pins.filter((p) => p.subjectId === s.id).length,
      tools: d.tools.filter((t) => t.subjectId === s.id).length,
    }))
  }

  async createSubject(input: { name: string; color?: SubjectColor; icon?: SubjectIcon }) {
    const d = await this.load()
    const existing = d.subjects.find((s) => norm(s.name) === norm(input.name))
    if (existing) return { id: existing.id, name: existing.name, created: false }
    const used = new Set(d.subjects.map((s) => s.color))
    const color = input.color ?? SUBJECT_COLOR_IDS.find((c) => !used.has(c)) ?? SUBJECT_COLOR_IDS[d.subjects.length % SUBJECT_COLOR_IDS.length]
    const order = Math.max(-1, ...d.subjects.map((s) => s.order)) + 1
    const s = await repo.createSubject(this.a, { name: input.name, color, icon: input.icon ?? 'book' }, order)
    return { id: s.id, name: s.name, created: true }
  }

  async getSubject(ref: string) {
    const d = await this.load()
    const s = this.subject(d, ref)
    return {
      id: s.id,
      name: s.name,
      notes: d.notes
        .filter((n) => n.subjectId === s.id)
        .sort((x, y) => y.updated.localeCompare(x.updated))
        .map((n) => ({ id: n.id, title: n.title, updated: n.updated, excerpt: n.excerpt, ...(n.meta.source ? { source: n.meta.source } : {}) })),
      pins: d.pins.filter((p) => p.subjectId === s.id).map((p) => ({ id: p.id, title: p.title, tex: p.tex, text: p.text, order: p.order })),
      tools: d.tools.filter((t) => t.subjectId === s.id).map((t) => ({ id: t.id, name: t.name, icon: t.icon })),
    }
  }

  // ---------- конспекты ----------

  async readNote(id: string) {
    const d = await this.load()
    const n = this.note(d, id)
    const s = d.subjects.find((x) => x.id === n.subjectId)!
    return { id: n.id, subject: s.name, title: n.title, path: n.path, updated: n.updated, ...n.meta, markdown: n.body }
  }

  /** Новый конспект. С source, который уже есть в предмете, — обновляет тот конспект (повторный перенос не плодит дубли). */
  async createNote(input: { subject: string; title: string; markdown: string; source?: string }) {
    const d = await this.load()
    const s = this.subject(d, input.subject)
    const { body, warnings } = await this.prepare(s, composeBody(input.markdown, input.title))
    const same = input.source ? d.notes.find((n) => n.subjectId === s.id && n.meta.source === input.source) : undefined
    if (same) {
      const saved = await repo.saveNote(this.a, same, body)
      return { id: saved.id, path: saved.path, action: 'updated' as const, warnings }
    }
    const created = await repo.createNote(this.a, s, body)
    const saved = input.source ? await repo.saveNote(this.a, { ...created, meta: { source: input.source } }, body) : created
    return { id: saved.id, path: saved.path, action: 'created' as const, warnings }
  }

  async updateNote(input: { id: string; mode: UpdateMode; markdown: string; section?: string }) {
    const d = await this.load()
    const n = this.note(d, input.id)
    const s = d.subjects.find((x) => x.id === n.subjectId)!
    let next: string
    if (input.mode === 'replace') {
      next = composeBody(input.markdown, /^#\s/.test(input.markdown.trimStart()) ? undefined : n.title)
    } else if (input.mode === 'append') {
      next = `${n.body.trimEnd()}\n\n${normalizeMarkdownMath(input.markdown).trim()}\n`
    } else {
      if (!input.section) throw new Error('Для replace_section нужен section — текст заголовка раздела')
      next = replaceSection(n.body, input.section, normalizeMarkdownMath(input.markdown))
    }
    const { body, warnings } = await this.prepare(s, next)
    const saved = await repo.saveNote(this.a, n, body)
    return { id: saved.id, path: saved.path, title: saved.title, warnings }
  }

  /** Внешние картинки → assets/, формулы и разметка — проверка, как их поймёт редактор. */
  private async prepare(s: Subject, body: string) {
    const warnings: string[] = []
    const localized = await this.localizeImages(s, body, warnings)
    warnings.push(...checkMarkdown(localized))
    return { body: localized, warnings }
  }

  private async localizeImages(s: Subject, md: string, warnings: string[]) {
    const re = /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^)\s]+)\)/g
    let out = md
    for (const [whole, alt, src] of md.matchAll(re)) {
      try {
        const rel = await this.saveImage(s, src)
        out = out.replace(whole, `![${alt}](${rel})`)
      } catch (e) {
        warnings.push(`Картинка не скачалась (${src.slice(0, 80)}): ${(e as Error).message}. В приложении внешние ссылки на картинки не показываются.`)
      }
    }
    return out
  }

  /** Картинка в «<Предмет>/Конспекты/assets/» (webp, до 2400 px). Возвращает путь для Markdown. */
  async addImage(input: { subject: string; source: string; alt?: string }) {
    const s = this.subject(await this.load(), input.subject)
    const rel = await this.saveImage(s, input.source)
    return { markdown: `![${input.alt ?? ''}](${rel})`, path: joinPath(s.dir, NOTES_DIR, rel) }
  }

  private async saveImage(s: Subject, source: string) {
    const { data, ext } = await toWebImage(await loadImage(source))
    const rel = `assets/${genId()}.${ext}`
    await this.a.writeBlob(joinPath(s.dir, NOTES_DIR, rel), new Blob([new Uint8Array(data)]))
    return rel
  }

  // ---------- закреп ----------

  async createPin(input: { subject: string; title: string; tex?: string; text?: string }) {
    const d = await this.load()
    const s = this.subject(d, input.subject)
    const warnings = checkPin(input.tex, input.text)
    const order = Math.max(-1, ...d.pins.filter((p) => p.subjectId === s.id).map((p) => p.order)) + 1
    const p = await repo.createPin(this.a, s, input, order)
    return { id: p.id, path: p.path, warnings }
  }

  async updatePin(input: { id: string; title?: string; tex?: string; text?: string }) {
    const d = await this.load()
    const p = d.pins.find((x) => x.id === input.id)
    if (!p) throw new Error(`Нет карточки с id «${input.id}»`)
    const next = { title: input.title ?? p.title, tex: input.tex ?? p.tex, text: input.text ?? p.text }
    const saved = await repo.updatePin(this.a, p, next)
    return { id: saved.id, path: saved.path, warnings: checkPin(next.tex, next.text) }
  }

  // ---------- тулзы ----------

  async importTool(input: { subject: string; name: string; html: string; icon?: ToolIcon }) {
    const s = this.subject(await this.load(), input.subject)
    const t = await repo.importTool(this.a, s, { name: input.name, html: input.html, icon: input.icon ?? 'calculator' })
    return { id: t.id, path: t.path }
  }

  // ---------- поиск и корзина ----------

  async search(input: { query: string; subject?: string; limit?: number }) {
    const d = await this.load()
    const only = input.subject ? this.subject(d, input.subject).id : undefined
    const terms = norm(input.query).split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    const name = (id: string) => d.subjects.find((s) => s.id === id)?.name
    const hits: { kind: 'note' | 'pin'; id: string; subject?: string; title: string; snippet: string; score: number }[] = []
    const consider = (kind: 'note' | 'pin', id: string, subjectId: string, title: string, text: string) => {
      if (only && subjectId !== only) return
      const hay = norm(`${title}\n${text}`)
      if (!terms.every((t) => hay.includes(t))) return
      const score = terms.reduce((sum, t) => sum + hay.split(t).length - 1 + (norm(title).includes(t) ? 5 : 0), 0)
      const at = Math.max(0, hay.indexOf(terms[0]) - 60)
      const snippet = `${at > 0 ? '…' : ''}${`${title}\n${text}`.slice(at, at + 180).replace(/\s+/g, ' ').trim()}…`
      hits.push({ kind, id, subject: name(subjectId), title, snippet, score })
    }
    for (const n of d.notes) consider('note', n.id, n.subjectId, n.title, n.body)
    for (const p of d.pins) consider('pin', p.id, p.subjectId, p.title, `${p.tex ?? ''}\n${p.text ?? ''}`)
    return hits.sort((x, y) => y.score - x.score).slice(0, input.limit ?? 20)
  }

  async trash(input: { kind: 'note' | 'pin' | 'tool'; id: string }) {
    const d = await this.load()
    const list = input.kind === 'note' ? d.notes : input.kind === 'pin' ? d.pins : d.tools
    const item = list.find((x) => x.id === input.id)
    if (!item) throw new Error(`Не нашёл: ${input.kind} «${input.id}»`)
    const trashPath = await repo.trashEntry(this.a, item.path)
    return { moved: item.path, trash: trashPath, note: 'Вернуть можно в приложении: Корзина → Восстановить (30 дней).' }
  }
}

// ---------- текст конспекта ----------

/** Тело конспекта: первая строка — «# Заголовок», формулы приведены к $…$ / $$…$$. */
export function composeBody(markdown: string, title?: string): string {
  let md = normalizeMarkdownMath(markdown.replace(/\r\n/g, '\n')).trim()
  const h1 = md.match(/^#\s+.*(\n|$)/)
  if (title?.trim()) {
    if (h1) md = md.slice(h1[0].length).trimStart()
    md = `# ${title.trim()}${md ? `\n\n${md}` : ''}`
  } else if (!h1) {
    throw new Error('Нужен заголовок: передай title или начни markdown с «# Заголовок»')
  }
  return `${md}\n`
}

/** Заменяет содержимое раздела под заголовком (до следующего заголовка того же или старшего уровня). */
export function replaceSection(body: string, section: string, markdown: string): string {
  const lines = body.split('\n')
  const heading = (l: string) => l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
  const start = lines.findIndex((l) => {
    const h = heading(l)
    return h && norm(h[2]) === norm(section)
  })
  if (start < 0) {
    const all = lines.map(heading).filter(Boolean).map((h) => h![2])
    throw new Error(`Нет раздела «${section}». Заголовки: ${all.join(' | ')}`)
  }
  const level = heading(lines[start])![1].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const h = heading(lines[i])
    if (h && h[1].length <= level) {
      end = i
      break
    }
  }
  const md = markdown.trim()
  const head = heading(md.split('\n')[0]) ? [] : [lines[start], '']
  return [...lines.slice(0, start), ...head, md, '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Что редактор поймёт не так: формулы, которые KaTeX не разберёт, и непарные «$». */
export function checkMarkdown(md: string): string[] {
  const warnings: string[] = []
  const tryTex = (tex: string, where: string) => {
    try {
      katex.renderToString(tex, { throwOnError: true, strict: 'ignore', displayMode: true })
    } catch (e) {
      warnings.push(`${where}: формула «${tex.trim().slice(0, 60)}» — ${(e as Error).message.replace(/^KaTeX parse error: /, '')}`)
    }
  }
  // блоки $$…$$ вырезаем, оставляя переводы строк, — номера строк не сбиваются
  const rest = md.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex: string) => {
    tryTex(tex, `Блок у строки ${md.slice(0, md.indexOf(m)).split('\n').length}`)
    return '\n'.repeat(m.split('\n').length - 1)
  })
  let fence = false
  rest.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence || /^\s*(```|~~~)/.test(line)) return
    const leftover = line.replace(/`[^`]*`/g, '').replace(/\$([^$\n]+)\$/g, (_m, tex: string) => {
      tryTex(tex, `Строка ${i + 1}`)
      return ''
    })
    if (/(?<!\\)\$/.test(leftover)) warnings.push(`Строка ${i + 1}: непарный «$» — редактор не поймёт формулу. Для знака доллара пиши «\\$».`)
  })
  return warnings
}

function checkPin(tex?: string, text?: string): string[] {
  const w: string[] = []
  if (tex) w.push(...checkMarkdown(`$$\n${tex}\n$$`))
  if (text?.includes('$')) w.push('В text формулы не рендерятся — это простой текст под формулой. Формулу клади в tex.')
  return w
}

// ---------- картинки ----------

async function loadImage(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const m = source.match(/^data:image\/[\w+.-]+;base64,(.+)$/)
    if (!m) throw new Error('Ожидался data:image/…;base64,…')
    return Buffer.from(m[1], 'base64')
  }
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    if (type && !/^(image\/|application\/octet-stream)/.test(type)) throw new Error(`Это не картинка (${type})`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_IMAGE) throw new Error('Картинка больше 25 МБ')
    return buf
  }
  const file = path.resolve(source)
  if (!/\.(png|jpe?g|gif|webp|bmp|svg|avif|tiff?)$/i.test(file)) throw new Error('Локальный файл должен быть картинкой (png, jpg, gif, webp, svg…)')
  if ((await fs.stat(file)).size > MAX_IMAGE) throw new Error('Картинка больше 25 МБ')
  return fs.readFile(file)
}

/** Как в приложении: растровое → webp до 2400 px; svg и анимированный gif — как есть. */
async function toWebImage(buf: Buffer): Promise<{ data: Buffer; ext: string }> {
  const meta = await sharp(buf, { animated: true }).metadata()
  if (meta.format === 'svg') return { data: buf, ext: 'svg' }
  if (meta.format === 'gif' && (meta.pages ?? 1) > 1) return { data: buf, ext: 'gif' }
  const data = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer()
  return { data, ext: 'webp' }
}
