/**
 * Какие схемы mermaid уже стали картой и сколько места под ней оставить в тексте: хеш кода → высота, px.
 * Пишет NoteCanvas, читает блок схемы (diagrams.ts): вместо рисунка — пустое место, код в .md не трогается.
 */
const heights = new Map<string, number>()
const listeners = new Set<() => void>()

export const mapSlots = {
  height: (hash: string) => heights.get(hash),
  set(next: Map<string, number>) {
    if (next.size === heights.size && [...next].every(([k, v]) => heights.get(k) === v)) return
    heights.clear()
    for (const [k, v] of next) heights.set(k, v)
    listeners.forEach((l) => l())
  },
  clear() {
    if (!heights.size) return
    heights.clear()
    listeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
}
