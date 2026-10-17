import { FileCode2, FileUp, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toolIconLabels, toolIcons } from '@/features/subjects/visuals'
import { fileSize } from '@/lib/format'
import { errorText, submitOnCtrlEnter } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { fileExt, fileTitle } from '@/storage/VaultAdapter'
import { fileKind } from '@/vault/format'
import { guessToolName } from '@/vault/repo'
import { useVault } from '@/vault/store'
import type { ToolIcon } from '@/types'

interface Target {
  subjectId: string
  /** Есть — переименовать (у HTML — и сменить иконку). */
  toolId?: string
}

const useTarget = create<{ target: Target | null; set: (t: Target | null) => void }>((set) => ({
  target: null,
  set: (target) => set({ target }),
}))

export const openToolDialog = (t: Target) => useTarget.getState().set(t)

const ICONS = Object.keys(toolIcons) as ToolIcon[]
const looksLikeHtml = (s: string) => /<(html|body|script|div|canvas|svg|style)[\s>]/i.test(s)

/** Иконка по ключевым словам названия — чтобы не выбирать вручную. */
export function guessToolIcon(name: string): ToolIcon {
  const n = name.toLowerCase()
  if (/матриц|определител|слау|вектор/.test(n)) return 'grid'
  if (/график|функци|plot|chart/.test(n)) return 'chart'
  if (/единиц|конверт|перевод/.test(n)) return 'ruler'
  if (/алгоритм|сложност|сортир|двоич|бинар/.test(n)) return 'binary'
  if (/таймер|время|помодоро/.test(n)) return 'timer'
  if (/таблиц/.test(n)) return 'table'
  if (/интеграл|производн|уравнен|формул/.test(n)) return 'function'
  return 'calculator'
}

/** Читает HTML-файл и сразу добавляет его в предмет (перетаскивание). */
export async function importHtmlFile(subjectId: string, file: File) {
  const html = await file.text()
  const name = guessToolName(html, file.name)
  return useVault.getState().importTool(subjectId, { name, html, icon: guessToolIcon(name) })
}

export function ToolDialog() {
  const target = useTarget((s) => s.target)
  const close = () => useTarget.getState().set(null)
  const tool = useVault((s) => s.tools.find((t) => t.id === target?.toolId))
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'file' | 'code'>('file')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<ToolIcon>('calculator')
  const [html, setHtml] = useState('')
  const [fileName, setFileName] = useState('')
  /** Не HTML: файл кладётся как есть. */
  const [file, setFile] = useState<File | null>(null)
  const [iconTouched, setIconTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) return
    setName(tool?.name ?? '')
    setIcon(tool?.icon ?? 'calculator')
    setHtml('')
    setFileName('')
    setFile(null)
    setIconTouched(!!tool)
    setMode('file')
  }, [target, tool])

  /** Имя подставляется, пока его не правили руками. */
  const autoName = () => (file ? fileTitle(file.name) : guessToolName(html, fileName))

  const acceptHtml = (code: string, from?: string) => {
    const untouched = !name.trim() || name === autoName()
    setHtml(code)
    setFileName(from ?? '')
    setFile(null)
    const guessed = guessToolName(code, from)
    if (untouched) setName(guessed)
    if (!iconTouched) setIcon(guessToolIcon(guessed))
  }

  const acceptFile = async (f: File) => {
    if (fileKind(fileExt(f.name)) === 'html') return acceptHtml(await f.text(), f.name)
    if (!name.trim() || name === autoName()) setName(fileTitle(f.name))
    setFile(f)
    setFileName(f.name)
    setHtml('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target || !name.trim()) return
    setBusy(true)
    try {
      const v = useVault.getState()
      if (tool) {
        await v.updateTool(tool.id, { name, icon })
      } else if (file) {
        const t = await v.importProjectFile(target.subjectId, { name: file.name, blob: file, title: name })
        navigate(`/s/${t.subjectId}/t/${t.id}`)
      } else {
        if (!looksLikeHtml(html)) throw new Error('Это не похоже на HTML. Нужен целый файл артефакта.')
        const t = await v.importTool(target.subjectId, { name, html, icon })
        navigate(`/s/${t.subjectId}/t/${t.id}`)
      }
      close()
    } catch (err) {
      toast.error(tool ? 'Не удалось сохранить' : 'Не удалось добавить', { description: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  const ready = tool ? !!name.trim() : !!name.trim() && (!!file || !!html.trim())
  const htmlish = tool ? tool.kind === 'html' : !file

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} onKeyDown={submitOnCtrlEnter} className="contents">
          <DialogHeader>
            <DialogTitle>{tool ? (htmlish ? 'Тулза' : 'Файл') : 'Добавить в проекты'}</DialogTitle>
            <DialogDescription>
              {tool
                ? htmlish
                  ? 'Название и иконка.'
                  : 'Название файла в папке «Проекты».'
                : 'PDF, презентация, документ, картинка или HTML-тулза. Тулза работает в песочнице, без доступа к конспектам.'}
            </DialogDescription>
          </DialogHeader>

          {!tool && (
            <div>
              <div role="tablist" aria-label="Откуда взять" className="liquid-2 mb-2 flex rounded-xl p-1">
                {(
                  [
                    ['file', 'Файл'],
                    ['code', 'Вставить HTML'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => {
                      setMode(m)
                      if (m === 'code' && file) {
                        setFile(null)
                        setFileName('')
                      }
                    }}
                    className={cn(
                      'flex-1 rounded-md py-1.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      mode === m ? 'liquid-active text-foreground!' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mode === 'file' ? (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files[0]
                    if (f) await acceptFile(f)
                  }}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {!fileName ? (
                    <Upload className="size-6 text-muted-foreground" />
                  ) : file ? (
                    <FileUp className="size-6 text-highlight" />
                  ) : (
                    <FileCode2 className="size-6 text-highlight" />
                  )}
                  <span className="text-[14px] font-medium break-all">{fileName || 'Выбрать или перетащить файл'}</span>
                  {fileName && <span className="text-[12px] text-muted-foreground">{fileSize(file ? file.size : new Blob([html]).size)}</span>}
                </button>
              ) : (
                <textarea
                  value={html}
                  onChange={(e) => acceptHtml(e.target.value)}
                  rows={7}
                  spellCheck={false}
                  aria-label="HTML-код тулзы"
                  placeholder={'<!doctype html>\n<html>…'}
                  className="w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              )}
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) await acceptFile(f)
                  e.target.value = ''
                }}
              />
            </div>
          )}

          <div>
            <label htmlFor="tool-name" className="mb-1 block text-[13px] font-medium">
              Название
            </label>
            <Input id="tool-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Калькулятор интегралов" maxLength={80} autoFocus={!!tool} />
          </div>

          {htmlish && (
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium">Иконка</legend>
              <div className="flex flex-wrap gap-2">
                {ICONS.map((i) => {
                  const Icon = toolIcons[i]
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={toolIconLabels[i]}
                      title={toolIconLabels[i]}
                      aria-pressed={icon === i}
                      onClick={() => {
                        setIcon(i)
                        setIconTouched(true)
                      }}
                      className={cn(
                        'flex size-10 items-center justify-center rounded-xl border outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
                        icon === i ? 'border-highlight bg-accent text-highlight' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <Icon className="size-5" />
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {tool ? 'Сохранить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
