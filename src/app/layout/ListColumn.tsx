import { ChevronDown, FileUp, Maximize2, Plus, SquarePen } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PinActions } from '@/features/pins/PinActions'
import { openPinEditor } from '@/features/pins/PinEditorDialog'
import { SubjectBadge, toolIcons } from '@/features/subjects/visuals'
import { ToolActions } from '@/features/tools/ToolActions'
import { openToolDialog } from '@/features/tools/ToolDialog'
import { useToolDrop } from '@/features/tools/useToolDrop'
import { relativeTime } from '@/lib/format'
import { listItem, listParent, spring } from '@/lib/motion'
import { templates } from '@/lib/templates'
import { Tex } from '@/lib/tex'
import { cn } from '@/lib/utils'
import type { Subject, SubjectTab } from '@/types'
import { useCreateNote, useNotesOf, usePinsOf, useSubject, useToolsOf } from '@/vault/hooks'
import { useUi } from '../store'

const tabs: { id: SubjectTab; label: string }[] = [
  { id: 'notes', label: 'Конспекты' },
  { id: 'pins', label: 'Закреп' },
  { id: 'tools', label: 'Тулзы' },
]

function useCurrentTab(): SubjectTab {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const t = params.get('tab') as SubjectTab | null
  if (t) return t
  return pathname.includes('/t/') ? 'tools' : 'notes'
}

/** Кнопка «создать» меняется по вкладке: конспект (с шаблонами), карточка, тулза. */
function CreateButton({ subject, tab }: { subject: Subject; tab: SubjectTab }) {
  const createNote = useCreateNote()
  if (tab === 'pins')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Новая карточка" onClick={() => openPinEditor({ subjectId: subject.id })}>
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Новая карточка закрепа</TooltipContent>
      </Tooltip>
    )
  if (tab === 'tools')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Добавить тулзу" onClick={() => openToolDialog({ subjectId: subject.id })}>
            <FileUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Добавить HTML-тулзу</TooltipContent>
      </Tooltip>
    )
  return (
    <div className="flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Новый конспект" onClick={() => createNote(subject.id)}>
            <SquarePen />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Новый конспект · Alt N</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="w-5" aria-label="Конспект по шаблону">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Шаблон</DropdownMenuLabel>
          {templates.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => createNote(subject.id, t.id)}>
              <div>
                <div>{t.label}</div>
                <div className="text-[12px] text-muted-foreground">{t.hint}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ListColumn() {
  const { subjectId, noteId, toolId } = useParams()
  const subject = useSubject(subjectId)
  const notes = useNotesOf(subjectId)
  const pins = usePinsOf(subjectId)
  const tools = useToolsOf(subjectId)
  const tab = useCurrentTab()
  const [, setParams] = useSearchParams()
  const openWindow = useUi((s) => s.openWindow)
  const windows = useUi((s) => s.windows)
  const drop = useToolDrop(subjectId)

  if (!subject) return null

  return (
    <aside
      aria-label={`Содержимое предмета «${subject.name}»`}
      {...drop.handlers}
      className={cn(
        'liquid-column-soft relative hidden w-[300px] shrink-0 flex-col border-r md:flex',
        drop.over && 'ring-2 ring-highlight ring-inset',
      )}
    >
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <SubjectBadge subject={subject} />
        <h2 className="flex-1 truncate text-[15px] font-semibold tracking-tight">{subject.name}</h2>
        <CreateButton subject={subject} tab={tab} />
      </header>

      <div role="tablist" aria-label="Разделы предмета" className="liquid-2 mx-4 mb-2 flex rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id })}
            className={cn(
              'relative flex-1 rounded-lg py-1.5 text-[13px] font-medium transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === t.id && <motion.span layoutId="tab-pill" transition={spring} className="liquid-active absolute inset-0 rounded-lg" />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <motion.ul
        key={`${subject.id}-${tab}`}
        variants={listParent}
        initial="hidden"
        animate="show"
        className="thin-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2 pb-4"
      >
        {tab === 'notes' &&
          notes.map((n) => (
            <motion.li key={n.id} variants={listItem}>
              <Link
                to={`/s/${subject.id}/n/${n.id}`}
                viewTransition
                data-active={noteId === n.id || undefined}
                className="block rounded-lg px-3 py-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-active:bg-accent"
              >
                <div className={cn('truncate text-[14px] font-semibold', !n.title && 'text-muted-foreground')}>
                  {n.title || 'Без названия'}
                </div>
                <div className="mt-0.5 flex gap-2 text-[13px] text-muted-foreground">
                  <span className="shrink-0 tabular-nums">{relativeTime(n.updated)}</span>
                  <span className="truncate">{n.excerpt || 'Нет текста'}</span>
                </div>
              </Link>
            </motion.li>
          ))}

        {tab === 'pins' &&
          pins.map((p) => {
            const floating = windows.some((w) => w.id === `pin:${p.id}`)
            return (
              <motion.li key={p.id} variants={listItem} className="group relative">
                <button
                  type="button"
                  onClick={() => openWindow('pin', p.id)}
                  className="w-full rounded-lg py-2.5 pr-10 pl-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[14px] font-semibold">{p.title}</span>
                    {floating && <Maximize2 aria-label="Открыто в окне" className="size-3.5 text-highlight" />}
                  </div>
                  {p.tex && (
                    <div className="mt-1 overflow-hidden text-[13px] text-muted-foreground">
                      <Tex tex={p.tex} className="block truncate" />
                    </div>
                  )}
                  <span className="sr-only">Открыть в плавающем окне</span>
                </button>
                <PinActions
                  pin={p}
                  siblings={pins}
                  className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                />
              </motion.li>
            )
          })}

        {tab === 'tools' &&
          tools.map((t) => {
            const Icon = toolIcons[t.icon]
            return (
              <motion.li key={t.id} variants={listItem} className="group relative">
                <Link
                  to={`/s/${subject.id}/t/${t.id}`}
                  viewTransition
                  data-active={toolId === t.id || undefined}
                  className="flex items-center gap-3 rounded-lg py-2.5 pr-10 pl-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-active:bg-accent"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-card shadow-card">
                    <Icon className="size-4 text-highlight" />
                  </span>
                  <span className="truncate text-[14px] font-medium">{t.name}</span>
                </Link>
                <ToolActions
                  tool={t}
                  className="absolute top-2.5 right-2 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                />
              </motion.li>
            )
          })}

        {((tab === 'notes' && !notes.length) || (tab === 'pins' && !pins.length) || (tab === 'tools' && !tools.length)) && (
          <EmptyList tab={tab} subjectId={subject.id} />
        )}
      </motion.ul>

      {drop.over && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl bg-primary px-3 py-2 text-center text-[13px] font-medium text-primary-foreground shadow-float">
          Отпусти — добавлю тулзу
        </div>
      )}
    </aside>
  )
}

function EmptyList({ tab, subjectId }: { tab: SubjectTab; subjectId: string }) {
  const createNote = useCreateNote()
  const content = {
    notes: {
      title: 'Конспектов пока нет',
      hint: 'Нажми «Новый конспект» или Alt N',
      action: 'Новый конспект',
      run: () => createNote(subjectId),
    },
    pins: {
      title: 'Закреп пуст',
      hint: 'Сюда кладут формулы и определения, которые нужны всегда под рукой',
      action: 'Карточка',
      run: () => openPinEditor({ subjectId }),
    },
    tools: {
      title: 'Инструментов нет',
      hint: 'Перетащи сюда HTML-файл артефакта — например, от Claude',
      action: 'Добавить тулзу',
      run: () => openToolDialog({ subjectId }),
    },
  }[tab]
  return (
    <li className="px-4 py-10 text-center">
      <p className="text-sm font-medium">{content.title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{content.hint}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={content.run}>
        <Plus /> {content.action}
      </Button>
    </li>
  )
}
