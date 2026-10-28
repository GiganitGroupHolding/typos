import { Placeholder } from '@tiptap/extensions'
import { TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BookOpen, Check, Loader2, MoreHorizontal, PenLine, Trash2, Type } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useUi, type NoteFont } from '@/app/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { openPinEditor } from '@/features/pins/PinEditorDialog'
import { relativeTime } from '@/lib/format'
import { toastUndo } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { dirname, joinPath } from '@/storage/VaultAdapter'
import type { Note } from '@/types'
import { sameBody } from '@/vault/format'
import { NoteConflictError, useVault, vaultFileUrl } from '@/vault/store'
import { BlockHandle } from './blocks/BlockHandle'
import { Folding } from './blocks/folding'
import { BubbleToolbar } from './BubbleToolbar'
import { buildExtensions } from './extensions'
import { NoteCanvas } from './map/NoteCanvas'
import { MathPopover, type MathEdit } from './MathPopover'
import { SideToolbar } from './SideToolbar'
import { TableMenu } from './TableMenu'
import { htmlMathToNodes, looksLikeMarkdown, normalizeMarkdownMath } from './texImport'

const SAVE_DELAY = 500

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

/** Открытые сейчас редакторы — чтобы не удалить «пустой» конспект, который снова на экране. */
const mounted = new Set<string>()

const isBlank = (md: string) => md.replace(/^#{1,6}\s*$/gm, '').trim() === ''

/*
 * Редактор конспекта (Tiptap). Панель — по мотивам 21st.dev «Rich Text Editor» (uvain).
 * Первая строка — заголовок, файл переименовывается по нему.
 */
export function NoteEditor({ note, autoFocus }: { note: Note; autoFocus?: boolean }) {
  const font = useUi((s) => s.noteFont)
  const setNoteFont = useUi((s) => s.setNoteFont)
  const toggleReading = useUi((s) => s.toggleReading)
  const navigate = useNavigate()
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [math, setMath] = useState<MathEdit | null>(null)
  const timer = useRef<number | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const id = note.id
  const noteDir = useRef(dirname(note.path))
  useEffect(() => {
    noteDir.current = dirname(note.path)
  }, [note.path])
  const fileInput = useRef<HTMLInputElement>(null)
  const [linkRequest, setLinkRequest] = useState(0)
  const formulaRef = useRef<() => void>(() => {})

  // ---------- файл поменяли снаружи (Claude, MCP, другое окно) ----------
  const conflict = useRef(false)
  /** Правки, которые не записались из-за конфликта, — на случай «Оставить мою» после ухода с заметки. */
  const unsaved = useRef('')

  /** Показать в редакторе текст с диска; правки дальше идут от него. */
  const loadFromDisk = useCallback(
    (body: string) => {
      const ed = editorRef.current
      conflict.current = false
      useVault.getState().adoptNote(id, body)
      if (!ed || ed.isDestroyed) return
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      const at = ed.state.selection.from
      ed.chain()
        .setContent(normalizeMarkdownMath(body), { contentType: 'markdown', emitUpdate: false })
        .command(({ tr }) => {
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))))
          return true
        })
        .run()
      setSaveState('saved')
    },
    [id],
  )

  const showConflict = useCallback(() => {
    conflict.current = true
    setSaveState('conflict')
    const takeDisk = async () => {
      await useVault.getState().refresh()
      const fresh = useVault.getState().notes.find((n) => n.id === id)
      if (fresh) return loadFromDisk(fresh.body)
      conflict.current = false
      toast('Конспект удалили или переместили')
      navigate(`/s/${note.subjectId}`)
    }
    const keepMine = async () => {
      const ed = editorRef.current
      const md = ed && !ed.isDestroyed ? ed.getMarkdown() : unsaved.current
      conflict.current = false
      setSaveState('saving')
      try {
        await useVault.getState().saveNote(id, md, { force: true })
        setSaveState('saved')
      } catch (e) {
        setSaveState('error')
        toast.error('Не удалось сохранить', { description: e instanceof Error ? e.message : String(e) })
      }
    }
    toast.warning('Конспект изменили снаружи', {
      id: `conflict-${id}`,
      description: 'Пока здесь шли правки, файл на диске поменялся. Какую версию оставить?',
      duration: Infinity,
      action: { label: 'С диска', onClick: () => void takeDisk() },
      cancel: { label: 'Мою', onClick: () => void keepMine() },
    })
  }, [id, loadFromDisk, navigate, note.subjectId])

  // ---------- автосохранение ----------
  const save = useCallback(async () => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const md = ed.getMarkdown()
    // пока не выбрали версию — ничего не пишем
    if (conflict.current) return void (unsaved.current = md)
    setSaveState('saving')
    try {
      await useVault.getState().saveNote(id, md)
      setSaveState((s) => (s === 'saving' ? 'saved' : s))
    } catch (e) {
      if (e instanceof NoteConflictError) {
        unsaved.current = md
        return showConflict()
      }
      setSaveState('error')
      toast.error('Не удалось сохранить', { description: e instanceof Error ? e.message : String(e) })
    }
  }, [id, showConflict])

  const flush = useCallback(() => {
    if (timer.current === null) return
    clearTimeout(timer.current)
    timer.current = null
    void save()
  }, [save])

  // ---------- формулы ----------
  const openMath = useCallback((pos: number, kind: MathEdit['kind'], mode: MathEdit['mode'], to?: number) => {
    const ed = editorRef.current
    if (!ed || !ed.isEditable) return
    const dom = mode === 'edit' ? (ed.view.nodeDOM(pos) as HTMLElement | null) : null
    let rect = dom?.getBoundingClientRect()
    if (!rect) {
      const c = ed.view.coordsAtPos(pos)
      rect = new DOMRect(c.left, c.top, 1, c.bottom - c.top)
    }
    const node = mode === 'edit' ? ed.state.doc.nodeAt(pos) : null
    const selected = mode === 'new' && to !== undefined && to > pos ? ed.state.doc.textBetween(pos, to) : ''
    setMath({ mode, kind, pos, to, latex: (node?.attrs.latex as string | undefined) ?? selected, rect })
  }, [])

  const extensions = useMemo(
    () => [
      ...buildExtensions({
        onMathClick: (_node, pos, kind) => openMath(pos, kind, 'edit'),
        onBlockMathCreated: (pos) => openMath(pos, 'block', 'edit'),
        resolveImage: (src) => vaultFileUrl(joinPath(noteDir.current, src)),
        diagrams: true,
      }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' && node.attrs.level === 1
            ? 'Заголовок'
            : 'Пиши… $x^2$ — формула, $$ — блок формулы, # — заголовок, - — список',
      }),
      Folding.configure({ noteId: note.id }),
    ],
    [openMath, note.id],
  )

  // ---------- картинки: вставка, перетаскивание, кнопка ----------
  const insertImages = useCallback(
    async (files: File[], at?: number) => {
      const ed = editorRef.current
      if (!ed) return
      for (const f of files) {
        try {
          const src = await useVault.getState().saveImage(id, f)
          ed.chain()
            .focus()
            .insertContentAt(at ?? ed.state.selection.from, { type: 'image', attrs: { src, alt: '' } })
            .run()
        } catch (e) {
          toast.error('Не удалось вставить картинку', { description: e instanceof Error ? e.message : String(e) })
        }
      }
    },
    [id],
  )
  const imagesOf = (list?: FileList | null) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'))

  const editor = useEditor(
    {
      extensions,
      ...(isBlank(note.body)
        ? { content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] } }
        : { content: normalizeMarkdownMath(note.body), contentType: 'markdown' as const }),
      autofocus: autoFocus ? 'start' : false,
      editorProps: {
        attributes: { 'aria-label': 'Текст конспекта', spellcheck: 'true', lang: 'ru' },
        // как в Notion: Ctrl+K — ссылка (если есть выделение), Ctrl+Shift+E — в формулу
        handleKeyDown: (view, event) => {
          const mod = event.ctrlKey || event.metaKey
          if (!mod || view.state.selection.empty) return false
          if (event.code === 'KeyK' && !event.shiftKey) {
            setLinkRequest((n) => n + 1)
            return true
          }
          if (event.code === 'KeyE' && event.shiftKey) {
            formulaRef.current()
            return true
          }
          return false
        },
        handlePaste: (view, event) => {
          const data = event.clipboardData
          const files = imagesOf(data?.files)
          if (files.length) {
            void insertImages(files)
            return true
          }
          // ответ нейросети / .md как обычный текст → разобрать Markdown с формулами
          const text = data?.getData('text/plain') ?? ''
          const ed = editorRef.current
          if (!ed || data?.getData('text/html') || view.state.selection.$from.parent.type.spec.code) return false
          if (!looksLikeMarkdown(text)) return false
          ed.commands.insertContent(normalizeMarkdownMath(text), { contentType: 'markdown' })
          return true
        },
        // отрендеренные KaTeX/MathJax и блоки кода с LaTeX → формулы
        transformPastedHTML: (html) => htmlMathToNodes(html),
        handleDrop: (view, event, _slice, moved) => {
          const files = imagesOf(event.dataTransfer?.files)
          if (moved || !files.length) return false
          void insertImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
          return true
        },
      },
      onUpdate: ({ transaction }) => {
        if (!transaction.docChanged) return
        setSaveState('dirty')
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          timer.current = null
          void save()
        }, SAVE_DELAY)
      },
    },
    [id],
  )
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // правки идут от текста, с которым открыли заметку
  const openedBody = useRef(note.body)
  useEffect(() => useVault.getState().adoptNote(id, openedBody.current), [id])

  // папку перечитали (фокус окна), а файл уже другой: без своих правок — тихо подгружаем.
  // Если правки есть, их сохранение упрётся в проверку и покажет выбор версии.
  useEffect(() => {
    if (!editor || conflict.current || timer.current !== null) return
    const base = useVault.getState().noteBase(id)
    if (base === undefined || sameBody(base, note.body)) return
    loadFromDisk(note.body)
    toast('Конспект обновился с диска', { id: `reload-${id}` })
  }, [editor, id, note.body, loadFromDisk])

  // режим чтения: текст не редактируется, панель скрыта
  const reading = useUi((s) => s.readingMode)
  const mapMode = useUi((s) => s.mapMode)
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!reading, false)
  }, [editor, reading])

  // сохранить при уходе: смена заметки, закрытие вкладки, сворачивание окна
  useEffect(() => {
    mounted.add(id)
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      mounted.delete(id)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
      // пустой конспект не оставляем (как Apple Notes). Через тик: StrictMode
      // и смена ключа размонтируют и сразу монтируют тот же редактор.
      setTimeout(() => {
        if (!mounted.has(id)) void useVault.getState().discardIfEmpty(id)
      })
    }
  }, [flush, id])

  const saveMath = (latex: string) => {
    if (!editor || !math) return
    const type = math.kind === 'inline' ? 'inlineMath' : 'blockMath'
    const chain = editor.chain().focus()
    if (math.mode === 'edit') {
      chain.command(({ tr }) => {
        const node = tr.doc.nodeAt(math.pos)
        if (!node) return false
        tr.setNodeMarkup(math.pos, undefined, { ...node.attrs, latex })
        return true
      })
    } else {
      chain.insertContentAt({ from: math.pos, to: math.to ?? math.pos }, { type, attrs: { latex } })
    }
    // курсор — сразу за формулой, чтобы продолжить писать
    chain
      .command(({ tr }) => {
        const at = math.mode === 'edit' ? math.pos : tr.mapping.map(math.pos, -1)
        const node = tr.doc.nodeAt(at)
        if (!node) return true
        const after = Math.min(at + node.nodeSize, tr.doc.content.size)
        tr.setSelection(TextSelection.near(tr.doc.resolve(after)))
        return true
      })
      .run()
    setMath(null)
  }

  const deleteMath = () => {
    if (!editor || !math) return
    if (math.mode === 'edit') {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(math.pos)
          if (!node) return false
          tr.delete(math.pos, math.pos + node.nodeSize)
          return true
        })
        .run()
    }
    setMath(null)
  }

  const cancelMath = () => {
    // пустая формула (только что из «$$ ») — убрать
    if (editor && math?.mode === 'edit' && !editor.state.doc.nodeAt(math.pos)?.attrs.latex) return deleteMath()
    editor?.commands.focus()
    setMath(null)
  }

  const formulaFromSelection = () => {
    const ed = editorRef.current
    if (ed) openMath(ed.state.selection.from, 'inline', 'new', ed.state.selection.to)
  }

  useEffect(() => {
    formulaRef.current = formulaFromSelection
  })

  const pinSelection = (text: string) => {
    const title = text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text
    openPinEditor({ subjectId: note.subjectId, title, text: text.length > 60 ? text : undefined })
  }

  const pinMath = (latex: string) => {
    if (math?.mode === 'edit') saveMath(latex)
    else setMath(null)
    openPinEditor({ subjectId: note.subjectId, tex: latex })
  }

  const remove = async () => {
    flush()
    const undo = await useVault.getState().trashNote(id)
    navigate(`/s/${note.subjectId}`)
    toastUndo('Конспект в корзине', undo, () => navigate(`/s/${note.subjectId}/n/${id}`))
  }

  return (
    <div className="flex min-h-full flex-col">
      <SideToolbar
        editor={editor}
        hidden={reading}
        onFormula={formulaFromSelection}
        onBlockFormula={() => editor && openMath(editor.state.selection.from, 'block', 'new')}
        onImage={() => fileInput.current?.click()}
      />
      {editor && <BubbleToolbar editor={editor} linkRequest={linkRequest} onFormula={formulaFromSelection} onPin={pinSelection} />}
      {editor && <TableMenu editor={editor} />}

      <div className="pointer-events-none sticky top-12 z-10 -mt-1 flex items-center justify-end gap-2 px-3 pt-1 [&>*]:pointer-events-auto">
        <div className="hidden">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void insertImages(imagesOf(e.target.files))
              e.target.value = ''
            }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {reading ? (
            <Button variant="ghost" size="sm" onClick={toggleReading}>
              <PenLine /> Редактировать
            </Button>
          ) : (
            <SaveIndicator state={saveState} />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Действия с конспектом">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuCheckboxItem checked={reading} onCheckedChange={toggleReading}>
                <BookOpen /> Режим чтения
              </DropdownMenuCheckboxItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Type /> Шрифт текста
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={font} onValueChange={(v) => setNoteFont(v as NoteFont)}>
                    <DropdownMenuRadioItem value="inter">Inter</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="golos">Golos</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="serif">PT Serif</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash2 /> Удалить конспект
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        className={cn(
          'note-prose mx-auto w-full pt-8 pr-20 pb-32 pl-6 transition-colors duration-(--dur-slow) lg:px-6',
          reading && 'note-reading',
        )}
        data-font={reading ? 'serif' : font}
      >
        <p className="mb-5 text-center text-[13px] text-muted-foreground">
          {note.created === note.updated ? 'Новый конспект' : `Изменено ${relativeTime(note.updated)}`}
        </p>
        {/* карта — слоем над текстом, в той же колонке */}
        <div className="relative">
          <EditorContent editor={editor} />
          {editor && <BlockHandle editor={editor} disabled={reading || mapMode} />}
          {editor && <NoteCanvas key={note.id} editor={editor} noteId={note.id} readOnly={reading} />}
        </div>
      </div>

      <MathPopover edit={math} onSave={saveMath} onDelete={deleteMath} onCancel={cancelMath} onPin={pinMath} />
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        'flex items-center gap-1 px-1 text-[12px]',
        state === 'error' || state === 'conflict' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {state === 'saving' || state === 'dirty' ? (
        <>
          <Loader2 className="size-3 animate-spin" /> Сохраняю
        </>
      ) : state === 'error' ? (
        'Ошибка сохранения'
      ) : state === 'conflict' ? (
        'Не сохранено: файл изменён снаружи'
      ) : (
        <>
          <Check className="size-3" /> Сохранено
        </>
      )}
    </span>
  )
}
