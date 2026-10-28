import { useEffect } from 'react'
import { accentFromHex } from '@/lib/accentColor'
import { SUBJECT_COLORS } from '@/lib/subjectPalette'
import type { SubjectColor } from '@/types'
import { useUi } from './store'

/*
 * Акцент приложения:
 *   • на общих экранах — нейтральный (data-accent="neutral"): белый в тёмной теме, графит в светлой;
 *     фон — прозрачное «жидкое стекло» с радужной призмой;
 *   • внутри предмета — цвет его иконки: --accent-h/--accent-c (OKLCH), из них в tokens.css строятся
 *     кнопки, значки, выделение, а фон-туманности тонируются этим цветом.
 * Интерфейс получает цвет сразу; плавное перетекание фона выполняет шейдер.
 */

export function initAccent() {
  document.documentElement.dataset.accent = 'neutral'
}

/** null — нейтральный акцент; цвет — акцент предмета. */
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

/** Акцент — по открытому предмету (или нейтральный вне предметов). */
export function useAccentSync(color: SubjectColor | undefined) {
  const responsive = useUi((s) => s.responsiveAccent)
  const fixed = useUi((s) => s.fixedAccent)
  useEffect(() => setAccent(responsive ? (color ?? null) : (fixed as `#${string}`)), [color, responsive, fixed])
}

/** Клик по логотипу — новый расклад фона и короткий «закрут» (liquid-shader.tsx слушает событие). */
export function shuffleBackground() {
  window.dispatchEvent(new Event('lava:shuffle'))
}
