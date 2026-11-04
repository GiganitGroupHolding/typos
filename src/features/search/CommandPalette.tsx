import {
  BookOpen,
  Eraser,
  FileText,
  Focus,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  LayoutDashboard,
  Moon,
  Pin,
  SquarePen,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { useShallow } from "zustand/react/shallow"
import { useUi } from "@/app/store"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/Command"
import { openClearSubjects } from "@/features/subjects/ClearSubjectsDialog"
import { openNewSubject } from "@/features/subjects/NewSubjectDialog"
import { SubjectBadge, toolIcon, toolIcons } from "@/features/subjects/visuals"
import { relativeTime } from "@/lib/format"
import type { Subject } from "@/types"
import { useCreateBoard, useCreateNote, useRecentNotes } from "@/vault/hooks"
import { useVault } from "@/vault/store"
import { buildDocs, createIndex, normalize, search, snippet, type SearchHit } from "./searchIndex"

interface Action {
  id: string
  label: string
  keywords: string
  icon: LucideIcon
  shortcut?: string
  run: () => void
}

function Snippet({ hit }: { hit: SearchHit }) {
  const parts = snippet(hit.text, hit.terms)
  if (!parts.length) return null
  return (
    <span className="line-clamp-2 text-[12px] text-muted-foreground">
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-selection px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  )
}

const KIND_ICON = { note: FileText, pin: Pin, board: LayoutDashboard } as const
const GROUPS: { kind: SearchHit["kind"]; heading: string }[] = [
  { kind: "note", heading: "Конспекты" },
  { kind: "pin", heading: "Закреп" },
  { kind: "tool", heading: "Проекты" },
  { kind: "board", heading: "Доски" },
  { kind: "subject", heading: "Предметы" },
]

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const ui = useUi.getState
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const createNote = useCreateNote()
  const createBoard = useCreateBoard()
  const recent = useRecentNotes(5)
  const data = useVault(useShallow((s) => ({ subjects: s.subjects, notes: s.notes, pins: s.pins, tools: s.tools, boards: s.boards })))
  const [query, setQuery] = useState("")
  const deferred = useDeferredValue(query)

  const index = useMemo(() => createIndex(buildDocs(data)), [data])
  const hits = useMemo(() => search(index, deferred), [index, deferred])

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const subjectById = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects])
  const currentSubject = pathname.match(/^\/s\/([^/]+)/)?.[1]
  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  const actions: Action[] = [
    {
      id: "new-note",
      label: "Новый конспект",
      keywords: "создать заметку",
      icon: SquarePen,
      shortcut: "Alt N",
      run: () => void createNote(currentSubject),
    },
    { id: "new-subject", label: "Новый предмет", keywords: "создать папку", icon: FolderPlus, run: openNewSubject },
    ...(currentSubject
      ? [
          {
            id: "new-board",
            label: "Новая доска",
            keywords: "создать полотно схема стикеры miro",
            icon: LayoutDashboard,
            run: () => void createBoard(currentSubject),
          },
          {
            id: "review",
            label: "Повторение закрепа",
            keywords: "карточки экзамен",
            icon: GraduationCap,
            run: () => navigate(`/s/${currentSubject}/review`),
          },
        ]
      : []),
    {
      id: "pins",
      label: "Открыть закреп",
      keywords: "панель текст ссылки",
      icon: Pin,
      shortcut: "Ctrl J",
      run: () => ui().setPinsOpen(true),
    },
    { id: "reading", label: "Режим чтения", keywords: "читать serif", icon: BookOpen, run: () => ui().toggleReading() },
    { id: "focus", label: "Режим фокуса", keywords: "скрыть колонки", icon: Focus, shortcut: "Ctrl \\", run: () => ui().toggleFocus() },
    { id: "theme", label: "Сменить тему", keywords: "тёмная светлая", icon: Moon, run: () => ui().cycleTheme() },
    { id: "trash", label: "Корзина", keywords: "удалённые восстановить", icon: Trash2, run: () => navigate("/trash") },
    { id: "clear", label: "Удалить все предметы…", keywords: "очистить начать заново", icon: Eraser, run: openClearSubjects },
    { id: "storage", label: "Хранилище", keywords: "хранилище диск", icon: FolderOpen, run: () => navigate("/welcome") },
  ]
  const q = normalize(deferred.trim())
  const shownActions = q ? actions.filter((a) => normalize(`${a.label} ${a.keywords}`).includes(q)) : actions

  const openHit = (h: SearchHit) => {
    if (h.kind === "note") navigate(`/s/${h.subjectId}/n/${h.refId}`)
    else if (h.kind === "pin") ui().openWindow("pin", h.refId)
    else if (h.kind === "tool") navigate(`/s/${h.subjectId}/t/${h.refId}`)
    else if (h.kind === "board") navigate(`/s/${h.subjectId}/b/${h.refId}`)
    else navigate(`/s/${h.refId}`)
  }

  const hitIcon = (h: SearchHit, subject?: Subject) => {
    if (h.kind === "subject" && subject) return <SubjectBadge subject={subject} size="sm" />
    if (h.kind === "tool") {
      const t = data.tools.find((x) => x.id === h.refId)
      const Icon = t ? toolIcon(t) : toolIcons.calculator
      return <Icon />
    }
    const Icon = KIND_ICON[h.kind as "note" | "pin" | "board"]
    return <Icon />
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Поиск и команды" description="Поиск по хранилищу" className="sm:max-w-xl">
      <Command shouldFilter={false} className="rounded-none!">
        <CommandInput value={query} onValueChange={setQuery} placeholder="Поиск" />
        <CommandList className="thin-scrollbar max-h-[min(60vh,460px)]">
          <CommandEmpty>Ничего не найдено</CommandEmpty>

          {!q && recent.length > 0 && (
            <CommandGroup heading="Недавние">
              {recent.map((n) => (
                <CommandItem key={n.id} value={`recent-${n.id}`} onSelect={() => run(() => navigate(`/s/${n.subjectId}/n/${n.id}`))}>
                  <FileText />
                  <span className="flex-1 truncate">{n.title || "Без названия"}</span>
                  <span className="text-xs text-muted-foreground">{relativeTime(n.updated)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {q &&
            GROUPS.map(({ kind, heading }) => {
              const group = hits.filter((h) => h.kind === kind)
              if (!group.length) return null
              return (
                <CommandGroup key={kind} heading={heading}>
                  {group.map((h) => {
                    const subject = subjectById.get(h.subjectId)
                    return (
                      <CommandItem key={h.id} value={h.id} onSelect={() => run(() => openHit(h))} className="items-start">
                        <span className="mt-0.5 [&_svg]:size-4">{hitIcon(h, subject)}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium">{h.title}</span>
                            {kind !== "subject" && subject && (
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{subject.name}</span>
                            )}
                          </span>
                          {(kind === "note" || kind === "pin" || kind === "board") && <Snippet hit={h} />}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}

          {!q && (
            <CommandGroup heading="Предметы">
              {data.subjects.map((s) => (
                <CommandItem key={s.id} value={`subject-${s.id}`} onSelect={() => run(() => navigate(`/s/${s.id}`))}>
                  <SubjectBadge subject={s} size="sm" />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {shownActions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Действия">
                {shownActions.map((a) => (
                  <CommandItem key={a.id} value={`action-${a.id}`} onSelect={() => run(a.run)}>
                    <a.icon />
                    {a.label}
                    {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
