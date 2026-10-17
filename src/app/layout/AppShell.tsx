import { useEffect } from 'react'
import { Outlet, useLocation, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
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
import { monitorConnection, useConnection } from '@/storage/connection'
import { SyncedAdapter } from '@/storage/syncedAdapter'
import { basename } from '@/storage/VaultAdapter'
import { useVault } from '@/vault/store'
import { useAccentSync } from '../accent'
import { useUi } from '../store'
import { useHotkeys } from '../useHotkeys'
import { AppSidebar } from './AppSidebar'
import { ConnectionBanner } from './ConnectionBanner'
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

/** Папку или сервер могли изменить снаружи (проводник, Obsidian, другое устройство) — перечитываем при возврате в окно. */
function useRefreshOnFocus() {
  useEffect(() => {
    const onFocus = () => {
      const kind = useVault.getState().adapter?.kind
      if (kind === 'folder' || kind === 'remote') void useVault.getState().refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}

/**
 * Синхронизация локальной копии и слежение за связью, пока открыт сервер хранения.
 * Связь вернулась или сервер сообщил об изменениях — сразу синхронизируем. Возвращает «остановить».
 */
function startServerSync(adapter: SyncedAdapter) {
  const { engine } = adapter
  engine.hooks.isOffline = () => useConnection.getState().status !== 'online'
  engine.hooks.onConflict = (path, copy) =>
    toast.warning('Файл правили в двух местах', {
      description: `«${basename(path)}» изменили и здесь, и на другом устройстве, пока не было связи. Обе версии сохранены, вторая — «${basename(copy)}».`,
      duration: 15_000,
    })
  adapter.onChanged = () => void useVault.getState().refresh()
  adapter.start()
  const stopMonitor = monitorConnection(adapter.remote, {
    onChange: (status, prev) => {
      if (status !== 'online') return
      engine.schedule(0)
      if (prev === 'offline') toast.success('Связь с сервером восстановлена', { id: 'connection' })
    },
    onServerChange: () => engine.schedule(150),
  })
  return () => {
    stopMonitor()
    adapter.stop()
    adapter.onChanged = undefined
    engine.hooks = { onPulled: engine.hooks.onPulled }
  }
}

function useServerSync() {
  const adapter = useVault((s) => s.adapter)
  useEffect(() => {
    if (adapter instanceof SyncedAdapter) return startServerSync(adapter)
  }, [adapter])
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
  useServerSync()
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
          <ConnectionBanner />
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
