import { ChevronRight, Focus, Pin, Search } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { useLiquidLens } from '@/components/ui/liquid-lens'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useBoard, useNote, useSubject, useTool } from '@/vault/hooks'
import { useUi } from '../store'
import { WindowControls } from './WindowControls'

export function TopBar() {
  const { subjectId, noteId, toolId, boardId } = useParams()
  const subject = useSubject(subjectId)
  const note = useNote(noteId)
  const tool = useTool(toolId)
  const board = useBoard(boardId)
  const leaf = note ? note.title || 'Без названия' : (tool?.name ?? board?.name)
  const pinsOpen = useUi((s) => s.pinsOpen)
  const togglePins = useUi((s) => s.togglePins)
  const focusMode = useUi((s) => s.focusMode)
  const toggleFocus = useUi((s) => s.toggleFocus)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const lens = useLiquidLens({ bezel: 12, refraction: 12, dispersion: 0.09, frost: 1, fallback: 'liquid liquid-lava' })

  return (
    <div data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-1 px-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger aria-label="Показать или скрыть предметы" />
        </TooltipTrigger>
        <TooltipContent>Предметы · Ctrl B</TooltipContent>
      </Tooltip>

      <nav
        data-tauri-drag-region
        aria-label="Путь"
        className="flex min-w-0 flex-1 items-center gap-1 px-1 text-[13px] text-muted-foreground"
      >
        {subject ? (
          <>
            <Link
              to={`/s/${subject.id}`}
              className="truncate rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {subject.name}
            </Link>
            {leaf && (
              <>
                <ChevronRight aria-hidden className="size-3.5 shrink-0" />
                <span aria-current="page" className="truncate text-foreground">
                  {leaf}
                </span>
              </>
            )}
          </>
        ) : null}
      </nav>

      <div ref={lens.attach} style={lens.style} className={cn(lens.className, 'flex items-center gap-0.5 rounded-full p-1')}>
        {lens.extras}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Поиск"
              className="rounded-full hover:bg-foreground/5"
              onClick={() => setPaletteOpen(true)}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Поиск · Ctrl K</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Режим фокуса"
              aria-pressed={focusMode}
              onClick={toggleFocus}
              className={cn('rounded-full hover:bg-foreground/5', focusMode && 'liquid-active hover:bg-transparent')}
            >
              <Focus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Режим фокуса · Ctrl \</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Закреп"
              aria-pressed={pinsOpen}
              onClick={togglePins}
              className={cn('rounded-full hover:bg-foreground/5', pinsOpen && 'liquid-active hover:bg-transparent')}
            >
              <Pin />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Закреп · Ctrl J</TooltipContent>
        </Tooltip>
      </div>
      <WindowControls />
    </div>
  )
}
