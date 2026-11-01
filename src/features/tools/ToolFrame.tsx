import { useEffect, useMemo, useRef } from 'react'
import { useResolvedTheme } from '@/app/theme'
import { cn } from '@/lib/utils'
import { TOOL_SANDBOX, withCsp, type ToolMessage } from './sandbox'

interface Props {
  html: string
  title: string

  runKey?: number
  className?: string
}

export function ToolFrame({ html, title, runKey = 0, className }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const theme = useResolvedTheme()
  const srcDoc = useMemo(() => withCsp(html), [html])

  const post = (msg: ToolMessage) => ref.current?.contentWindow?.postMessage(msg, '*')

  useEffect(() => {
    post({ type: 'theme', value: theme })
  }, [theme])

  return (
    <iframe
      key={runKey}
      ref={ref}
      title={title}
      sandbox={TOOL_SANDBOX}
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      onLoad={() => post({ type: 'theme', value: theme })}
      className={cn('size-full border-0 bg-background', className)}
    />
  )
}
