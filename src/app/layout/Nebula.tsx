import { lazy, Suspense } from "react"
import { useUi } from "@/app/store"

const Shader = lazy(() => import("@/components/ui/InteractiveNebulaShader"))

export function Nebula({ avoidText = false }: { avoidText?: boolean }) {
  const backdrop = useUi((s) => s.backdrop)
  return (
    <Suspense fallback={null}>
      <Shader avoidText={avoidText} variant={backdrop} />
    </Suspense>
  )
}
