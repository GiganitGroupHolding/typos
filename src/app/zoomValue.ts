/** Масштаб окна в процентах, кратный десяти. */
export function normalizeZoom(value: number): number {
  return Number.isFinite(value) ? Math.min(200, Math.max(50, Math.round(value / 10) * 10)) : 100
}
/** Горячие клавиши масштаба не зависят от раскладки клавиатуры. */
export function zoomShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'code'>, current: number): number | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (event.code === 'Digit0' || event.code === 'Numpad0') return 100
  if (event.code === 'Equal' || event.code === 'NumpadAdd') return normalizeZoom(current + 10)
  if (event.code === 'Minus' || event.code === 'NumpadSubtract') return normalizeZoom(current - 10)
}
