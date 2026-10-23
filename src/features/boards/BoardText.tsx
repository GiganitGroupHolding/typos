import { memo, type ReactNode } from 'react'
import { Tex } from '@/lib/tex'

// формулы $…$ и **жирный** внутри строки
const INLINE = /(\$[^$\n]+\$|\*\*[^*\n]+\*\*)/g

function inline(line: string, key: string): ReactNode[] {
  return line.split(INLINE).map((part, i) => {
    if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) return <Tex key={`${key}-${i}`} tex={part.slice(1, -1)} />
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <b key={`${key}-${i}`}>{part.slice(2, -2)}</b>
    return part
  })
}

/**
 * Текст карточки доски — маленькое подмножество Markdown: заголовки «#», списки «- », **жирный»,
 * формулы $…$ и $$…$$. Остальное показывается как есть.
 */
export const BoardText = memo(function BoardText({ text }: { text: string }) {
  const out: ReactNode[] = []
  text.split(/(\$\$[\s\S]+?\$\$)/).forEach((chunk, c) => {
    if (chunk.startsWith('$$') && chunk.endsWith('$$') && chunk.length > 4) {
      out.push(<Tex key={c} tex={chunk.slice(2, -2).trim()} block className="block overflow-hidden" />)
      return
    }
    chunk
      .replace(/^\n+|\n+$/g, '')
      .split('\n')
      .forEach((line, i) => {
        const key = `${c}-${i}`
        const h = line.match(/^(#{1,6})\s+(.*)$/)
        if (h) {
          out.push(
            <div key={key} className={h[1].length === 1 ? 'text-[1.35em] leading-tight font-bold' : 'text-[1.1em] font-semibold'}>
              {inline(h[2], key)}
            </div>,
          )
          return
        }
        const li = line.match(/^\s*[-*+]\s+(.*)$/)
        if (li) {
          out.push(
            <div key={key} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span className="min-w-0">{inline(li[1], key)}</span>
            </div>,
          )
          return
        }
        out.push(<div key={key}>{line ? inline(line, key) : ' '}</div>)
      })
  })
  return <>{out}</>
})
