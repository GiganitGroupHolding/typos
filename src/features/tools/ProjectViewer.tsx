import { Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { kindLabels, toolIcon } from '@/features/subjects/visuals'
import { fileSize } from '@/lib/format'
import { errorText } from '@/lib/undo'
import { cn } from '@/lib/utils'
import type { Tool } from '@/types'
import { downloadProjectFile, readProjectBlob } from './projectFiles'
import { ToolFrame } from './ToolFrame'

export function ProjectViewer({ tool, runKey = 0 }: { tool: Tool; runKey?: number }) {
  if (tool.kind === 'html') return <ToolFrame html={tool.html} title={tool.name} runKey={runKey} />

  return <FileView key={`${tool.path}:${runKey}`} tool={tool} />
}

type Loaded = { blob: Blob; url: string } | { error: string } | null

function useProjectFile(path: string, ext: string): Loaded {
  const [file, setFile] = useState<Loaded>(null)
  useEffect(() => {
    let alive = true
    let url = ''
    readProjectBlob(path, ext).then(
      (blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setFile({ blob, url })
      },
      (err) => alive && setFile({ error: errorText(err) }),
    )
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, ext])
  return file
}

function FileView({ tool }: { tool: Tool }) {
  const file = useProjectFile(tool.path, tool.ext)
  if (!file) return <Spinner />
  if ('error' in file) return <FileCard tool={tool} note={file.error} />
  switch (tool.kind) {
    case 'image':
      return <ImageView url={file.url} name={tool.name} />
    case 'pdf':
      return <iframe src={file.url} title={tool.name} className="size-full border-0" />
    case 'video':
      return (
        <div className="flex size-full items-center justify-center bg-black/90 p-2">
          <video src={file.url} controls playsInline className="max-h-full max-w-full rounded-lg" />
        </div>
      )
    case 'audio':
      return (
        <FileCard tool={tool} size={file.blob.size}>
          <audio src={file.url} controls className="w-full max-w-md" />
        </FileCard>
      )
    case 'text':
      return <TextView blob={file.blob} />
    case 'docx':
    case 'pptx':
      return <OfficeView blob={file.blob} kind={tool.kind} title={tool.name} />
    default:
      return (
        <FileCard tool={tool} size={file.blob.size} note="Такой файл браузер не показывает. Скачай оригинал и открой в своей программе." />
      )
  }
}

function Spinner({ text }: { text?: string }) {
  return (
    <div role="status" className="flex size-full flex-col items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      {text ?? 'Открываю…'}
    </div>
  )
}

function FileCard({ tool, size, note, children }: { tool: Tool; size?: number; note?: string; children?: ReactNode }) {
  const Icon = toolIcon(tool)
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className="size-12 text-highlight" strokeWidth={1.5} />
      <div>
        <div className="text-[17px] font-semibold">{tool.name}</div>
        <div className="text-[13px] text-muted-foreground">
          {kindLabels[tool.kind]}
          {tool.ext && ` · .${tool.ext}`}
          {size !== undefined && ` · ${fileSize(size)}`}
        </div>
      </div>
      {children}
      {note && <p className="max-w-sm text-[13px] text-muted-foreground">{note}</p>}
      <Button variant="outline" size="sm" onClick={() => void downloadProjectFile(tool)}>
        <Download /> Скачать оригинал
      </Button>
    </div>
  )
}

function ImageView({ url, name }: { url: string; name: string }) {
  const [actual, setActual] = useState(false)
  return (
    <div className={cn('size-full overflow-auto', !actual && 'flex items-center justify-center p-4')}>
      <button
        type="button"
        aria-label={actual ? 'Вписать в окно' : 'В натуральную величину'}
        onClick={() => setActual((v) => !v)}
        className={cn(
          'block outline-none focus-visible:ring-2 focus-visible:ring-ring',
          actual ? 'm-auto cursor-zoom-out' : 'size-full cursor-zoom-in',
        )}
      >
        <img src={url} alt={name} draggable={false} className={cn('select-none', actual ? 'max-w-none' : 'size-full object-contain')} />
      </button>
    </div>
  )
}

const TEXT_LIMIT = 2 * 1024 * 1024

function TextView({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void blob
      .slice(0, TEXT_LIMIT)
      .text()
      .then((t) => alive && setText(t))
    return () => {
      alive = false
    }
  }, [blob])
  if (text === null) return <Spinner />
  return (
    <pre className="size-full overflow-auto p-5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
      {text}
      {blob.size > TEXT_LIMIT && '\n\n… Дальше не показано: файл больше 2 МБ. Целиком — «Скачать».'}
    </pre>
  )
}

const OFFICE_CSS = `
html,body{margin:0;min-height:100%;background:transparent;font-family:system-ui,sans-serif}
#root{min-height:100vh}
.docx-wrapper{background:transparent!important;padding:24px 16px!important}
.docx-wrapper>section.docx{margin:0 auto 24px!important;border-radius:4px;box-shadow:0 1px 3px rgb(0 0 0/.14),0 10px 30px rgb(0 0 0/.1)!important}
.pptx-preview-wrapper{background:transparent!important;padding:16px 0 6px}
.pptx-preview-slide-wrapper{margin:0 auto 16px!important;border-radius:10px;box-shadow:0 1px 3px rgb(0 0 0/.14),0 10px 30px rgb(0 0 0/.1)}
`

function officeDoc() {
  const src = `${location.origin}/viewers/office.js`
  const csp = [
    "default-src 'none'",
    `script-src ${src}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data: blob:',
    'media-src data: blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="color-scheme" content="light dark"><style>${OFFICE_CSS}</style></head><body><div id="root"></div><script src="${src}"></script></body></html>`
}

type OfficeMessage = { type: 'boot' } | { type: 'ready'; pages: number } | { type: 'error'; message: string }

function OfficeView({ blob, kind, title }: { blob: Blob; kind: 'docx' | 'pptx'; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | { error: string }>('loading')
  const srcDoc = useMemo(() => officeDoc(), [])

  useEffect(() => {
    let booted = false
    let timer = 0
    const onMessage = async (e: MessageEvent<OfficeMessage>) => {
      const win = ref.current?.contentWindow
      if (!win || e.source !== win) return
      if (e.data?.type === 'boot') {
        booted = true
        const data = await blob.arrayBuffer()
        win.postMessage({ type: 'render', kind, data }, '*', [data])
      } else if (e.data?.type === 'ready') setStatus('ready')
      else if (e.data?.type === 'error') setStatus({ error: String(e.data.message) })
    }
    const onLoad = () => {
      timer = window.setTimeout(
        () => !booted && setStatus({ error: 'Не загрузился просмотрщик документов (public/viewers/office.js).' }),
        1500,
      )
    }
    const frame = ref.current
    addEventListener('message', onMessage)
    frame?.addEventListener('load', onLoad)
    return () => {
      clearTimeout(timer)
      removeEventListener('message', onMessage)
      frame?.removeEventListener('load', onLoad)
    }
  }, [blob, kind])

  return (
    <div className="relative size-full">
      <iframe
        ref={ref}
        title={title}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        className={cn('size-full border-0', status !== 'ready' && 'invisible')}
      />
      {status === 'loading' && (
        <div className="absolute inset-0">
          <Spinner text={kind === 'pptx' ? 'Открываю презентацию…' : 'Открываю документ…'} />
        </div>
      )}
      {typeof status === 'object' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-muted-foreground">
          <p className="font-medium text-foreground">Не получилось показать файл</p>
          <p className="max-w-sm">{status.error}</p>
          <p>Оригинал можно скачать кнопкой сверху.</p>
        </div>
      )}
    </div>
  )
}
