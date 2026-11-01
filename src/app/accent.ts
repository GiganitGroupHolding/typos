import { useEffect } from 'react'
import { accentFromHex } from '@/lib/accentColor'
import { SUBJECT_COLORS } from '@/lib/subjectPalette'
import type { SubjectColor } from '@/types'
import { useUi } from './store'

export function initAccent() {
  document.documentElement.dataset.accent = 'neutral'
}

export function setAccent(color: SubjectColor | `#${string}` | null) {
  const root = document.documentElement
  const next = color ?? 'neutral'
  if (root.dataset.accent === next) return
  const c = color?.startsWith('#') ? accentFromHex(color) : color && SUBJECT_COLORS.find((x) => x.id === color)
  if (c) {
    root.style.setProperty('--accent-h', c.hue.toFixed(1))
    root.style.setProperty('--accent-c', String(c.chroma))
  }
  root.dataset.accent = next
}

export function useAccentSync(color: SubjectColor | undefined) {
  const responsive = useUi((s) => s.responsiveAccent)
  const fixed = useUi((s) => s.fixedAccent)
  useEffect(() => setAccent(responsive ? (color ?? null) : (fixed as `#${string}`)), [color, responsive, fixed])
}

export function shuffleBackground() {
  window.dispatchEvent(new Event('lava:shuffle'))
}
