interface Edit {
  start: number
  end: number
  lines: string[]
}

function edits(base: string[], next: string[]): Edit[] {
  let start = 0
  while (start < base.length && start < next.length && base[start] === next[start]) start++
  let end = base.length
  let last = next.length
  while (end > start && last > start && base[end - 1] === next[last - 1]) {
    end--
    last--
  }
  const n = end - start
  const m = last - start
  // Большие замены сравниваем целиком, чтобы не блокировать интерфейс матрицей различий.
  if (n * m > 1_000_000) return [{ start, end, lines: next.slice(start, last) }]
  const width = m + 1
  const lcs = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * width + j] =
        base[start + i] === next[start + j] ? 1 + lcs[(i + 1) * width + j + 1] : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
  const result: Edit[] = []
  let i = 0
  let j = 0
  let edit: Edit | undefined
  while (i < n || j < m) {
    if (i < n && j < m && base[start + i] === next[start + j]) {
      edit = undefined
      i++
      j++
      continue
    }
    if (!edit) {
      edit = { start: start + i, end: start + i, lines: [] }
      result.push(edit)
    }
    if (j < m && (i === n || lcs[i * width + j + 1] > lcs[(i + 1) * width + j])) edit.lines.push(next[start + j++])
    else edit.end = start + ++i
  }
  return result
}

/** Объединяет независимые правки строк; пересекающиеся изменения требуют выбора версии. */
export function mergeText(base: string, mine: string, theirs: string): string | null {
  const normalize = (text: string) => text.replace(/\r\n/g, "\n")
  base = normalize(base)
  mine = normalize(mine)
  theirs = normalize(theirs)
  if (mine === theirs || theirs === base) return mine
  if (mine === base) return theirs
  const lines = base.split("\n")
  const left = edits(lines, mine.split("\n"))
  const right = edits(lines, theirs.split("\n"))
  const combined = [...left]
  for (const b of right) {
    let duplicate = false
    for (const a of left) {
      if (a.start === b.start && a.end === b.end && a.lines.join("\n") === b.lines.join("\n")) {
        duplicate = true
        continue
      }
      if (
        Math.max(a.start, b.start) < Math.min(a.end, b.end) ||
        (a.start === a.end && a.start >= b.start && a.start <= b.end) ||
        (b.start === b.end && b.start >= a.start && b.start <= a.end)
      )
        return null
    }
    if (!duplicate) combined.push(b)
  }
  for (const edit of combined.sort((a, b) => b.start - a.start)) lines.splice(edit.start, edit.end - edit.start, ...edit.lines)
  return lines.join("\n")
}
