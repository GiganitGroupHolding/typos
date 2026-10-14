import { Keyboard, Pin, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tex } from '@/lib/tex'
import { cn } from '@/lib/utils'

export interface MathEdit {
  mode: 'new' | 'edit'
  kind: 'inline' | 'block'
  /** Позиция узла (edit) или место вставки (new). */
  pos: number
  /** Конец выделения, которое заменит новая формула. */
  to?: number
  latex: string
  rect: DOMRect
}

interface Props {
  edit: MathEdit | null
  onSave: (latex: string) => void
  onDelete: () => void
  onCancel: () => void
  /** «В закреп»: сделать из формулы карточку предмета. */
  onPin?: (latex: string) => void
}

type MathfieldEl = HTMLElement & { value: string }

/**
 * Редактор формулы: LaTeX с живым превью + визуальный ввод MathLive (грузится лениво,
 * только при первом открытии вкладки «Визуально»).
 */
export function MathPopover({ edit, onSave, onDelete, onCancel, onPin }: Props) {
  const [latex, setLatex] = useState('')
  const [visual, setVisual] = useState(false)
  const [mlState, setMlState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const fieldHost = useRef<HTMLDivElement>(null)
  const field = useRef<MathfieldEl | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!edit) return
    setLatex(edit.latex)
    setVisual(false)
  }, [edit])

  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => edit?.rect ?? new DOMRect() } }), [edit])

  // MathLive: ленивая загрузка и синхронизация с LaTeX
  useEffect(() => {
    if (!visual || !edit) return
    let cancelled = false
    setMlState((s) => (s === 'ready' ? s : 'loading'))
    import('mathlive')
      .then(({ MathfieldElement }) => {
        if (cancelled || !fieldHost.current) return
        // шрифты KaTeX уже подключены глобально, звуки не нужны
        MathfieldElement.fontsDirectory = null
        MathfieldElement.soundsDirectory = null
        const mf = new MathfieldElement() as unknown as MathfieldEl
        mf.value = latex
        mf.setAttribute('aria-label', 'Визуальный редактор формулы')
        mf.className = 'math-field'
        mf.addEventListener('input', () => setLatex(mf.value))
        fieldHost.current.replaceChildren(mf)
        field.current = mf
        setMlState('ready')
        requestAnimationFrame(() => mf.focus())
      })
      .catch(() => !cancelled && setMlState('error'))
    return () => {
      cancelled = true
    }
    // latex намеренно не в зависимостях: поле создаётся один раз на открытие вкладки
  }, [visual, edit])

  const switchTo = (v: boolean) => {
    if (!v && field.current) setLatex(field.current.value)
    setVisual(v)
    if (!v) requestAnimationFrame(() => textarea.current?.focus())
  }

  const commit = () => {
    const value = (visual && field.current ? field.current.value : latex).trim()
    if (!value) onDelete()
    else onSave(value)
  }

  const block = edit?.kind === 'block'

  return (
    <Popover
      open={!!edit}
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-[min(460px,calc(100vw-24px))] p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          textarea.current?.focus()
          textarea.current?.select()
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          <div role="tablist" aria-label="Способ ввода" className="liquid-2 flex rounded-lg p-0.5">
            {[
              { v: false, label: 'LaTeX' },
              { v: true, label: 'Визуально' },
            ].map((t) => (
              <button
                key={t.label}
                role="tab"
                aria-selected={visual === t.v}
                onClick={() => switchTo(t.v)}
                className={cn(
                  'rounded px-2.5 py-1 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  visual === t.v ? 'liquid-active text-foreground!' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="flex-1 px-2 text-[12px] text-muted-foreground">{block ? 'Блочная формула' : 'В строке'}</span>
          {edit?.mode === 'edit' && (
            <Button variant="ghost" size="icon-xs" aria-label="Удалить формулу" onClick={onDelete}>
              <Trash2 />
            </Button>
          )}
        </div>

        <div className="p-3">
          {visual ? (
            <div
              onKeyDown={(e) => {
                // события из shadow DOM MathLive всплывают сюда
                if (e.key === 'Enter' && (block ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
                  e.preventDefault()
                  commit()
                }
              }}
            >
              <div ref={fieldHost} className="min-h-12 rounded-lg border bg-background px-2 py-1.5" />
              {mlState === 'loading' && <p className="mt-2 text-[12px] text-muted-foreground">Загружаю визуальный редактор…</p>}
              {mlState === 'error' && (
                <p className="mt-2 text-[12px] text-destructive">Не удалось загрузить MathLive. Пиши в LaTeX.</p>
              )}
              {mlState === 'ready' && (
                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Keyboard className="size-3.5" /> Дроби: «/», степень: «^», индекс: «_», корень: «sqrt»
                </p>
              )}
            </div>
          ) : (
            <textarea
              ref={textarea}
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (block ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
                  e.preventDefault()
                  commit()
                }
              }}
              rows={block ? 4 : 2}
              spellCheck={false}
              placeholder={block ? '\\sum_{k=1}^{n} a_k' : 'x^2 + y^2 = r^2'}
              aria-label="Формула в LaTeX"
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}

          <div aria-live="polite" className="thin-scrollbar mt-2 min-h-10 overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 text-center">
            {latex.trim() ? <Tex tex={latex} block={block} /> : <span className="text-[12px] text-muted-foreground">Превью</span>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="flex-1 text-[11px] text-muted-foreground">{block ? 'Ctrl Enter' : 'Enter'} — готово · Esc — отмена</span>
          {onPin && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!latex.trim()}
              onClick={() => onPin((visual && field.current ? field.current.value : latex).trim())}
            >
              <Pin /> В закреп
            </Button>
          )}
          <Button size="sm" onClick={commit}>
            Готово
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
