import { motion } from 'motion/react'
import { FileDown, FileUp, FolderOpen, GraduationCap, Pin, Plus, SquarePen } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { useLiquidLens } from '@/components/ui/liquid-lens'
import { useUi } from '@/app/store'
import { PinBody } from '@/features/pins/PinCard'
import { openPinEditor } from '@/features/pins/PinEditorDialog'
import { SubjectActions } from '@/features/subjects/SubjectActions'
import { SubjectBadge, subjectStyle } from '@/features/subjects/visuals'
import { openToolDialog } from '@/features/tools/ToolDialog'
import { ToolDock } from '@/features/tools/ToolDock'
import { pickAndImportNotes } from '@/features/import/importFiles'
import { useFileDrop } from '@/features/import/useFileDrop'
import { useCreateNote, useNotesOf, usePinsOf, useSubject, useToolsOf } from '@/vault/hooks'
import { plural, relativeTime } from '@/lib/format'
import { listItem, listParent, pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const PINS_PREVIEW = 4

/** Главная предмета — bento: конспекты, закреп, проекты. */
export function SubjectHome() {
  const { subjectId } = useParams()
  const [params] = useSearchParams()
  const subject = useSubject(subjectId)
  const notes = useNotesOf(subjectId)
  const pins = usePinsOf(subjectId)
  const tools = useToolsOf(subjectId)
  const createNote = useCreateNote()
  const openWindow = useUi((s) => s.openWindow)
  const setPinsOpen = useUi((s) => s.setPinsOpen)
  const drop = useFileDrop(subjectId)
  const navigate = useNavigate()
  if (!subject) return <Navigate to="/" replace />
  const tab = params.get('tab')

  return (
    <motion.div {...pageEnter} {...drop.handlers} style={subjectStyle(subject)} className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <header className="flex items-center gap-4">
        <SubjectBadge subject={subject} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[32px] leading-tight font-bold tracking-tight">{subject.name}</h1>
          <p className="text-[15px] text-muted-foreground">
            {plural(notes.length, ['конспект', 'конспекта', 'конспектов'])} ·{' '}
            {notes[0] ? `изменён ${relativeTime(notes[0].updated)}` : 'пока пусто'}
          </p>
        </div>
        <SubjectActions subject={subject} />
      </header>

      <motion.div variants={listParent} initial="hidden" animate="show" className="mt-8 grid auto-rows-min grid-cols-1 gap-4 lg:grid-cols-3">
        <Tile className="lg:col-span-2 lg:row-span-2" highlight={tab === 'notes'} title="Конспекты" icon={<SquarePen />} actions={[
            { label: 'Импорт', icon: <FileDown />, onClick: () => void pickAndImportNotes(subject.id, navigate) },
            { label: 'Новый', icon: <Plus />, onClick: () => createNote(subject.id) },
          ]}>
          {notes.length ? (
            <ul className="-mx-2">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link to={`/s/${subject.id}/n/${n.id}`} viewTransition className="group flex items-start gap-3 rounded-xl px-2 py-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{n.title || 'Без названия'}</div>
                      <div className="line-clamp-2 text-[13px] text-muted-foreground">{n.excerpt || 'Нет текста'}</div>
                    </div>
                    <span className="shrink-0 pt-0.5 text-[12px] text-muted-foreground tabular-nums">{relativeTime(n.updated)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Первый конспект появится здесь" />
          )}
        </Tile>

        <Tile highlight={tab === 'pins'} title="Закреп" icon={<Pin />} actions={[{ label: 'Карточка', icon: <Plus />, onClick: () => openPinEditor({ subjectId: subject.id }) }]}>
          {pins.length ? (
            <>
              <ul className="space-y-2">
                {pins.slice(0, PINS_PREVIEW).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openWindow('pin', p.id)}
                      className="w-full rounded-xl border bg-background px-3 py-2 text-left outline-none transition-colors duration-(--dur-fast) hover:border-(--subject)/40 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PinBody pin={p} size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {pins.length > PINS_PREVIEW && (
                  <Button size="sm" variant="ghost" onClick={() => setPinsOpen(true)}>
                    Ещё {pins.length - PINS_PREVIEW}
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/s/${subject.id}/review`} viewTransition>
                    <GraduationCap /> Повторение
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <Empty text="Закрепи формулы, которые нужны всегда" />
          )}
        </Tile>

        <Tile highlight={tab === 'tools' || drop.over} title="Проекты" icon={<FolderOpen />} actions={[{ label: 'Добавить', icon: <FileUp />, onClick: () => openToolDialog({ subjectId: subject.id }) }]}>
          {tools.length ? (
            <div className="flex flex-col items-start gap-3">
              <ToolDock tools={tools} />
              <p className="text-[13px] text-muted-foreground">Перетащи сюда файл: PDF, презентацию, документ, картинку или HTML.</p>
            </div>
          ) : (
            <Empty text={drop.over ? 'Отпусти — добавлю' : 'Перетащи сюда PDF, презентацию, документ, картинку или HTML-тулзу'} />
          )}
        </Tile>
      </motion.div>
    </motion.div>
  )
}

function Tile({
  title,
  icon,
  actions = [],
  highlight,
  className,
  children,
}: {
  title: string
  icon: ReactNode
  actions?: { label: string; icon: ReactNode; onClick: () => void }[]
  highlight?: boolean
  className?: string
  children: ReactNode
}) {
  const lens = useLiquidLens({ bezel: 22, refraction: 22, dispersion: 0.08, frost: 4, variant: 'card', fallback: 'liquid liquid-lava' })
  return (
    <motion.section
      ref={lens.attach}
      variants={listItem}
      style={lens.style}
      className={cn(
        lens.className,
        'rounded-[var(--radius-surface)] p-5 outline-2 outline-transparent transition-[outline-color] duration-(--dur-slow)',
        highlight && 'outline-(--subject)/50',
        className,
      )}
    >
      <header className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase [&>svg]:size-4 [&>svg]:text-(--subject)">
        {icon}
        <span className="flex-1">{title}</span>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium tracking-normal normal-case hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-3.5"
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </header>
      {children}
    </motion.section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">{text}</p>
}
