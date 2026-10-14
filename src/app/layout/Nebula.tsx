import { lazy, Suspense } from 'react'
import { useUi } from '../store'

// three.js — отдельным чанком: фон появляется чуть позже интерфейса и не тормозит старт
const Shader = lazy(() => import('@/components/ui/liquid-shader'))

/** Фон: туманности или металлические пузыри (переключатель в сайдбаре). avoidText — открыт конспект. */
export function Nebula({ avoidText = false }: { avoidText?: boolean }) {
  const backdrop = useUi((s) => s.backdrop)
  return (
    <Suspense fallback={null}>
      <Shader avoidText={avoidText} variant={backdrop} />
    </Suspense>
  )
}
