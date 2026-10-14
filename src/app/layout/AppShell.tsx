import { useEffect } from 'react'
import { Outlet, useLocation, useParams, useSearchParams } from 'react-router'
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { FloatingWindows } from '@/features/pins/FloatingWindows'
import { PinEditorDialog } from '@/features/pins/PinEditorDialog'
import { PinsDrawer } from '@/features/pins/PinsDrawer'
import { ToolDialog } from '@/features/tools/ToolDialog'
import { CommandPalette } from '@/features/search/CommandPalette'
import { ClearSubjectsDialog } from '@/features/subjects/ClearSubjectsDialog'
import { NewSubjectDialog } from '@/features/subjects/NewSubjectDialog'
import { cn } from '@/lib/utils'
import { useSubject } from '@/vault/hooks'
import { useVault } from '@/vault/store'
import { useAccentSync } from '../accent'
import { useUi } from '../store'
import { useHotkeys } from '../useHotkeys'
import { AppSidebar } from './AppSidebar'
import { ListColumn } from './ListColumn'
import { TopBar } from './TopBar'
import { Nebula } from './Nebula'

/** Режим фокуса прячет обе левые колонки; выход — возвращает сайдбар. */
function FocusSync() {
  const focusMode = useUi((s) => s.focusMode)
  const { setOpen } = useSidebar()
  useEffect(() => {
    setOpen(!focusMode)
  }, [focusMode, setOpen])
  return null
}

/** Папку могли изменить снаружи (проводник, Obsidian) — перечитываем при возврате в окно. */
function useRefreshOnFocus() {
  useEffect(() => {
    const onFocus = () => useVault.getState().adapter?.kind === 'folder' && void useVault.getState().refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}

/** Ярлык «Поиск» у установленного приложения открывает /?search=1. */
function useSearchShortcut() {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (!params.has('search')) return
    useUi.getState().setPaletteOpen(true)
    params.delete('search')
    setParams(params, { replace: true })
  }, [params, setParams])
}

export function AppShell() {
  useHotkeys()
  useRefreshOnFocus()
  useSearchShortcut()
  const { subjectId } = useParams()
  // внутри предмета акцент — цвет его иконки, вне предметов — нейтральный
  useAccentSync(useSubject(subjectId)?.color)
  const { pathname } = useLocation()
  const focusMode = useUi((s) => s.focusMode)

  return (
    <SidebarProvider className="h-dvh overflow-hidden">
      <div aria-hidden className="ambient">
        <Nebula avoidText={pathname.includes('/n/')} />
      </div>
      <FocusSync />
      <AppSidebar />
      <SidebarInset className="flex-row overflow-hidden bg-transparent">
        {subjectId && !focusMode && <ListColumn />}
        {/* бумага — под конспектом; на остальных экранах стеклянные карточки лежат прямо на авроре */}
        <div id="main" className={cn('relative flex min-w-0 flex-1 flex-col', pathname.includes('/n/') && 'paper')}>
          {/* панель поверх прокрутки: текст уходит под матовое стекло */}
          <div className="glass-bar absolute inset-x-0 top-0 z-20">
            <TopBar />
          </div>
          <div key={pathname} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pt-12">
            <Outlet />
          </div>
          <PinsDrawer />
        </div>
      </SidebarInset>
      <FloatingWindows />
      <CommandPalette />
      <NewSubjectDialog />
      <PinEditorDialog />
      <ToolDialog />
      <ClearSubjectsDialog />
    </SidebarProvider>
  )
}
