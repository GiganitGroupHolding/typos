import katex from 'katex'
import 'katex/dist/katex.min.css'
import { memo, useMemo } from 'react'

export const Tex = memo(function Tex({ tex, block = false, className }: { tex: string; block?: boolean; className?: string }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: 'ignore' }), [tex, block])
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
})
