import { isTauri } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { registerSW } from "virtual:pwa-register"

export function setupPwa() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV || isTauri()) return
  const update = registerSW({
    onNeedRefresh() {
      toast("Доступна новая версия", {
        duration: Infinity,
        action: { label: "Обновить", onClick: () => void update(true) },
      })
    },
    onOfflineReady() {
      toast.success("Готово к работе без интернета")
    },
  })
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

export function useInstallPrompt() {
  const [available, setAvailable] = useState(!!deferred)
  useEffect(() => {
    const l = () => setAvailable(!!deferred)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    deferred = null
    setAvailable(false)
  }
  return { available, install }
}
