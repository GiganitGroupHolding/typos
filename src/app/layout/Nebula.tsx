import { lazy, Suspense } from 'react'
import { useUi } from '../store'

const Shader = lazy(() => import('@/components/ui/liquid-shader'))

export function Nebula({ avoidText = false }: { avoidText?: boolean }) {
  const backdrop = useUi((s) => s.backdrop)
  return (
    <Suspense fallback={null}>
      <Shader avoidText={avoidText} variant={backdrop} />
    </Suspense>
  )
}
