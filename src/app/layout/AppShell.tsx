import { useEffect } from "react"
import { Outlet, useLocation, useParams, useSearchParams } from "react-router"
import { toast } from "sonner"
import { useAccentSync } from "@/app/accent"
import { useUi } from "@/app/store"
import { useHotkeys } from "@/app/useHotkeys"
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/Sidebar"
import { FloatingWindows } from "@/features/pins/FloatingWindows"
import { PinEditorDialog } from "@/features/pins/PinEditorDialog"
import { PinsDrawer } from "@/features/pins/PinsDrawer"
import { CommandPalette } from "@/features/search/CommandPalette"
import { ClearSubjectsDialog } from "@/features/subjects/ClearSubjectsDialog"
import { NewSubjectDialog } from "@/features/subjects/NewSubjectDialog"
import { ToolDialog } from "@/features/tools/ToolDialog"
import { cn } from "@/lib/utils"
import { SyncedAdapter } from "@/storage/syncedAdapter"
import { basename } from "@/storage/VaultAdapter"
import { useSubject } from "@/vault/hooks"
import { useVault } from "@/vault/store"
import { AppSidebar } from "./AppSidebar"
import { ConnectionBanner } from "./ConnectionBanner"
import { ListColumn } from "./ListColumn"
import { Nebula } from "./Nebula"
import { TopBar } from "./TopBar"

function FocusSync() {
  const focusMode = useUi((s) => s.focusMode)
  const { setOpen } = useSidebar()
  useEffect(() => {
    setOpen(!focusMode)
  }, [focusMode, setOpen])
  return null
}

function useRefreshOnFocus() {
  useEffect(() => {
    const onFocus = () => {
      const kind = useVault.getState().adapter?.kind
      if (kind === "folder" || kind === "remote") void useVault.getState().refresh()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])
}

function useServerSync() {
  const adapter = useVault((s) => s.adapter)
  useEffect(() => {
    if (!(adapter instanceof SyncedAdapter)) return
    adapter.start({
      onChanged: () => void useVault.getState().refresh(),
      onConflict: (path, copy) =>
        toast.warning("Файл изменён на двух устройствах", {
          description: `Обе версии «${basename(path)}» сохранены. Копия: «${basename(copy)}».`,
          duration: 15_000,
        }),
      onReconnected: () => toast.success("Связь с сервером восстановлена", { id: "connection" }),
    })
    return () => adapter.stop()
  }, [adapter])
}

function useSearchShortcut() {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (!params.has("search")) return
    useUi.getState().setPaletteOpen(true)
    params.delete("search")
    setParams(params, { replace: true })
  }, [params, setParams])
}

export function AppShell() {
  useHotkeys()
  useRefreshOnFocus()
  useServerSync()
  useSearchShortcut()
  const { subjectId } = useParams()

  useAccentSync(useSubject(subjectId)?.color)
  const { pathname } = useLocation()
  const focusMode = useUi((s) => s.focusMode)

  return (
    <SidebarProvider className="h-dvh overflow-hidden">
      <div aria-hidden className="ambient">
        <Nebula avoidText={pathname.includes("/n/")} />
      </div>
      <FocusSync />
      <AppSidebar />
      <SidebarInset className="flex-row overflow-hidden bg-transparent">
        {subjectId && !focusMode && <ListColumn />}

        <div id="main" className={cn("relative flex min-w-0 flex-1 flex-col", pathname.includes("/n/") && "paper")}>
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
