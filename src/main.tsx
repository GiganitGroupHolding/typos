import "@fontsource-variable/inter"
import "@fontsource-variable/golos-text"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource/pt-serif/400.css"
import "@fontsource/pt-serif/700.css"
import "@fontsource-variable/unbounded"
import "./index.css"
import { isTauri } from "@tauri-apps/api/core"
import { MotionGlobalConfig } from "motion/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { initAccent } from "@/app/accent"
import { App } from "@/app/App"
import { setupPwa } from "@/app/pwa"

if (import.meta.env.DEV && new URLSearchParams(location.search).has("noanim")) {
  MotionGlobalConfig.skipAnimations = true
}

initAccent()
setupPwa()

if (isTauri()) {
  document.documentElement.dataset.desktop = ""
  document.addEventListener("contextmenu", (event) => event.preventDefault())
}

if (typeof document.startViewTransition === "function") {
  const start = document.startViewTransition.bind(document)
  document.startViewTransition = ((arg?: Parameters<typeof start>[0]) => {
    const t = start(arg)
    t.ready.catch(() => {})
    t.finished.catch(() => {})
    return t
  }) as typeof document.startViewTransition
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
