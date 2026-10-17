import type { Node as PMNode } from '@tiptap/pm/model'

/*
 * Разделы конспекта, как в Notion: заголовку подчиняется всё до следующего заголовка того же или более высокого уровня.
 * Перетаскивание заголовка двигает весь раздел, сворачивание прячет его содержимое.
 */

export const headingLevel = (n: PMNode | null | undefined): number | null => (n?.type.name === 'heading' ? (n.attrs.level as number) : null)

/** Блоки верхнего уровня [from, to) по номерам: для заголовка — весь его раздел, для остального — сам блок. */
export function sectionRange(doc: PMNode, index: number): [number, number] {
  const level = headingLevel(doc.maybeChild(index))
  if (level === null) return [index, index + 1]
  let end = index + 1
  while (end < doc.childCount) {
    const l = headingLevel(doc.child(end))
    if (l !== null && l <= level) break
    end++
  }
  return [index, end]
}

/** Позиция начала блока верхнего уровня с номером index (index = childCount — конец документа). */
export function blockPos(doc: PMNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index && i < doc.childCount; i++) pos += doc.child(i).nodeSize
  return pos
}

/** Ключ заголовка для запоминания свёрнутости: уровень и текст (переживает правки в других местах). */
export const headingKey = (n: PMNode) => `${n.attrs.level as number}:${n.textContent.trim()}`

/** Номера блоков, скрытых свёрнутыми заголовками. */
export function foldedBlocks(doc: PMNode, collapsed: Set<string>): { headings: number[]; hidden: Set<number> } {
  const headings: number[] = []
  const hidden = new Set<number>()
  doc.forEach((n, _off, i) => {
    if (hidden.has(i) || headingLevel(n) === null || !collapsed.has(headingKey(n))) return
    const [from, to] = sectionRange(doc, i)
    if (to - from < 2) return
    headings.push(i)
    for (let k = from + 1; k < to; k++) hidden.add(k)
  })
  return { headings, hidden }
}

/**
 * Перенос блоков [from, to) в промежуток перед блоком gap (по номерам). null — переносить некуда
 * (промежуток внутри переносимого или рядом с ним).
 */
export function moveTarget(from: number, to: number, gap: number): number | null {
  if (gap >= from && gap <= to) return null
  return gap
}
