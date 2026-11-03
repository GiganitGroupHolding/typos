import { FolderOpen } from "lucide-react"
import { MotionConfig } from "motion/react"
import { useEffect, type ReactNode } from "react"
import { createBrowserRouter, RouterProvider } from "react-router"
import { AppShell } from "@/app/layout/AppShell"
import { Button } from "@/components/ui/Button"
import { GlassFilter } from "@/components/ui/LiquidButton"
import { Toaster } from "@/components/ui/Sonner"
import { TooltipProvider } from "@/components/ui/Tooltip"
import { HomePage } from "@/pages/HomePage"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { SubjectHome } from "@/pages/SubjectHome"
import { useVault } from "@/vault/store"
import { useDesktopZoom } from "./desktopZoom"
import { useThemeSync } from "./theme"

const loadNote = () => import("@/pages/NotePage").then((m) => ({ Component: m.NotePage }))
const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500))
idle(() => void loadNote())

const router = createBrowserRouter([
  { path: "/welcome", lazy: () => import("@/pages/WelcomePage").then((m) => ({ Component: m.WelcomePage })) },
  {
    path: "/",
    element: <VaultShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "s/:subjectId", element: <SubjectHome /> },
      { path: "s/:subjectId/n/:noteId", lazy: loadNote },
      { path: "s/:subjectId/t/:toolId", lazy: () => import("@/pages/ToolPage").then((m) => ({ Component: m.ToolPage })) },
      { path: "s/:subjectId/b/:boardId", lazy: () => import("@/pages/BoardPage").then((m) => ({ Component: m.BoardPage })) },
      { path: "s/:subjectId/review", lazy: () => import("@/pages/ReviewPage").then((m) => ({ Component: m.ReviewPage })) },
      { path: "trash", lazy: () => import("@/pages/TrashPage").then((m) => ({ Component: m.TrashPage })) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])

function VaultShell() {
  return (
    <VaultGate>
      <AppShell />
    </VaultGate>
  )
}

function VaultGate({ children }: { children: ReactNode }) {
  const status = useVault((s) => s.status)
  const error = useVault((s) => s.error)
  const init = useVault((s) => s.init)
  const remote = useVault((s) => s.adapter?.kind === "remote")
  const switchToBrowser = useVault((s) => s.switchToBrowser)

  useEffect(() => {
    void init()
  }, [init])

  if (status === "needs-permission") return <PermissionScreen />
  if (status === "error")
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[17px] font-semibold">Не удалось открыть конспекты</p>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => void init()}>Попробовать снова</Button>
        {remote && (
          <Button variant="ghost" onClick={() => void switchToBrowser()}>
            Открыть хранилище браузера
          </Button>
        )}
      </div>
    )

  if (status === "loading") return <div className="min-h-dvh bg-sidebar" aria-busy="true" />
  return children
}

function PermissionScreen() {
  const folder = useVault((s) => s.pendingFolder)
  const grantAccess = useVault((s) => s.grantAccess)
  const switchToBrowser = useVault((s) => s.switchToBrowser)
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm rounded-3xl border bg-card p-8 text-center shadow-float">
        <FolderOpen className="mx-auto size-10 text-highlight" />
        <h1 className="mt-4 text-[20px] font-bold tracking-tight">Открыть папку «{folder}»?</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Браузер спрашивает разрешение при каждом запуске. Выбери «Разрешить при каждом посещении» — и вопрос исчезнет.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button size="lg" autoFocus onClick={() => void grantAccess()}>
            Разрешить доступ
          </Button>
          <Button size="lg" variant="ghost" onClick={() => void switchToBrowser()}>
            Открыть хранилище браузера
          </Button>
        </div>
      </div>
    </main>
  )
}

export function App() {
  useThemeSync()
  useDesktopZoom()
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={400}>
        <RouterProvider router={router} />
        <Toaster position="bottom-center" />
        <GlassFilter />
      </TooltipProvider>
    </MotionConfig>
  )
}
