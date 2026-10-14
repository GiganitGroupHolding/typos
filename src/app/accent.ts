import { useEffect } from 'react'
import { SUBJECT_COLORS } from '@/lib/subjectPalette'
import type { SubjectColor } from '@/types'

/*
 * Акцент приложения:
 *   • на общих экранах — нейтральный (data-accent="neutral"): белый в тёмной теме, графит в светлой;
 *     фон — прозрачное «жидкое стекло» с радужной призмой;
 *   • внутри предмета — цвет его иконки: --accent-h/--accent-c (OKLCH), из них в tokens.css строятся
 *     кнопки, значки, выделение, а фон-туманности тонируются этим цветом.
 * Оттенок меняется по кратчайшему пути по кругу и плавно перетекает (@property --accent-h).
 */

let hue = 4

export function initAccent() {
  document.documentElement.dataset.accent = 'neutral'
}

/** null — нейтральный акцент; цвет — акцент предмета. */
export function setAccent(color: SubjectColor | null) {
  const root = document.documentElement
  const next = color ?? 'neutral'
  if (root.dataset.accent === next) return
  root.classList.add('accent-anim')
  window.setTimeout(() => root.classList.remove('accent-anim'), 1000)
  const c = color && SUBJECT_COLORS.find((x) => x.id === color)
  if (c) {
    const from = ((hue % 360) + 360) % 360
    hue += ((c.hue - from + 540) % 360) - 180 // кратчайший путь; OKLCH понимает оттенок за 360
    root.style.setProperty('--accent-h', hue.toFixed(1))
    root.style.setProperty('--accent-c', String(c.chroma))
  }
  root.dataset.accent = next
}

/** Акцент — по открытому предмету (или нейтральный вне предметов). */
export function useAccentSync(color: SubjectColor | undefined) {
  useEffect(() => setAccent(color ?? null), [color])
}

/** Клик по логотипу — новый расклад фона и короткий «закрут» (liquid-shader.tsx слушает событие). */
export function shuffleBackground() {
  window.dispatchEvent(new Event('lava:shuffle'))
}
