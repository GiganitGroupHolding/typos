import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { useEffect } from "react"
import { toast } from "sonner"
import { errorText } from "@/lib/errors"
import { useUi } from "./store"
import { zoomShortcut } from "./zoomValue"

export function useDesktopZoom() {
  useEffect(() => {
    if (!isTauri()) return
    let stopped = false
    let applying = false
    let applied = 100
    const sync = async () => {
      if (applying || stopped) return
      applying = true
      try {
        do {
          const requested = useUi.getState().desktopZoom
          try {
            await getCurrentWebview().setZoom(requested / 100)
            applied = requested
          } catch (error) {
            if (stopped) return
            toast.error("Не удалось изменить масштаб", {
              description: errorText(error),
            })
            if (useUi.getState().desktopZoom === requested) useUi.getState().setDesktopZoom(applied)
            else continue
          }
        } while (!stopped && applied !== useUi.getState().desktopZoom)
      } finally {
        applying = false
      }
    }
    const unsubscribe = useUi.subscribe((state, previous) => {
      if (state.desktopZoom !== previous.desktopZoom) void sync()
    })
    const onKey = (event: KeyboardEvent) => {
      const zoom = zoomShortcut(event, useUi.getState().desktopZoom)
      if (zoom === undefined || event.defaultPrevented) return
      event.preventDefault()
      useUi.getState().setDesktopZoom(zoom)
    }
    window.addEventListener("keydown", onKey)
    void sync()
    return () => {
      stopped = true
      unsubscribe()
      window.removeEventListener("keydown", onKey)
    }
  }, [])
}
