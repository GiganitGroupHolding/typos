import { useEffect, useSyncExternalStore } from "react"
import { useUi } from "./store"

const query = "(prefers-color-scheme: dark)"

function subscribe(cb: () => void) {
  const mq = window.matchMedia(query)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}

const systemDark = () => window.matchMedia(query).matches

export function useResolvedTheme(): "light" | "dark" {
  const pref = useUi((s) => s.theme)
  const isSystemDark = useSyncExternalStore(subscribe, systemDark, () => false)
  return pref === "system" ? (isSystemDark ? "dark" : "light") : pref
}

export function useThemeSync() {
  const theme = useResolvedTheme()
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
    root.style.colorScheme = theme
  }, [theme])
}
