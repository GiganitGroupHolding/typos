import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemePref = 'light' | 'dark' | 'system'
export type NoteFont = 'inter' | 'golos' | 'serif'
/** Фон: прозрачные туманности или металлические пузыри. */
export type Backdrop = 'nebula' | 'metal'

export interface FloatingWindow {
  id: string
  kind: 'pin' | 'tool'
  refId: string
  /** Позиция каскада, фиксируется при открытии (фокус меняет только z-order). */
  slot: number
  /** Слой. Порядок массива не меняем: перестановка iframe в DOM перезагружает тулзу. */
  z: number
}

interface UiState {
  theme: ThemePref
  noteFont: NoteFont
  backdrop: Backdrop
  /** Только чтение: без панели, PT Serif, бумажный фон. */
  readingMode: boolean
  focusMode: boolean
  pinsOpen: boolean
  paletteOpen: boolean
  windows: FloatingWindow[]
  setTheme: (t: ThemePref) => void
  cycleTheme: () => void
  toggleBackdrop: () => void
  setNoteFont: (f: NoteFont) => void
  toggleReading: () => void
  toggleFocus: () => void
  setPinsOpen: (v: boolean) => void
  togglePins: () => void
  setPaletteOpen: (v: boolean) => void
  openWindow: (kind: FloatingWindow['kind'], refId: string) => void
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
}

// localStorage может быть недоступен (приватный режим) — не падаем.
const safeStorage = createJSONStorage(() => {
  try {
    const k = '__probe__'
    localStorage.setItem(k, k)
    localStorage.removeItem(k)
    return localStorage
  } catch {
    const mem = new Map<string, string>()
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    }
  }
})

const order: ThemePref[] = ['light', 'dark', 'system']

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      noteFont: 'inter',
      backdrop: 'nebula',
      readingMode: false,
      focusMode: false,
      pinsOpen: false,
      paletteOpen: false,
      windows: [],
      setTheme: (theme) => set({ theme }),
      cycleTheme: () => set((s) => ({ theme: order[(order.indexOf(s.theme) + 1) % order.length] })),
      toggleBackdrop: () => set((s) => ({ backdrop: s.backdrop === 'metal' ? 'nebula' : 'metal' })),
      setNoteFont: (noteFont) => set({ noteFont }),
      toggleReading: () => set((s) => ({ readingMode: !s.readingMode })),
      toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
      setPinsOpen: (pinsOpen) => set({ pinsOpen }),
      togglePins: () => set((s) => ({ pinsOpen: !s.pinsOpen })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      openWindow: (kind, refId) =>
        set((s) => {
          const id = `${kind}:${refId}`
          const z = Math.max(0, ...s.windows.map((w) => w.z)) + 1
          if (s.windows.some((w) => w.id === id))
            return { windows: s.windows.map((w) => (w.id === id ? { ...w, z } : w)) }
          return { windows: [...s.windows, { id, kind, refId, slot: s.windows.length % 6, z }] }
        }),
      closeWindow: (id) => set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),
      focusWindow: (id) =>
        set((s) => {
          const top = Math.max(0, ...s.windows.map((w) => w.z))
          const w = s.windows.find((x) => x.id === id)
          if (!w || w.z === top) return s
          return { windows: s.windows.map((x) => (x.id === id ? { ...x, z: top + 1 } : x)) }
        }),
    }),
    {
      name: 'studynotes-ui',
      storage: safeStorage,
      partialize: (s) => ({ theme: s.theme, noteFont: s.noteFont, backdrop: s.backdrop }),
      // v1: светлая тема по умолчанию — прежнее «как в системе» переводим на светлую один раз
      version: 1,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<Pick<UiState, 'theme' | 'noteFont' | 'backdrop'>>
        if (version < 1 && (!s.theme || s.theme === 'system')) s.theme = 'light'
        return s as UiState
      },
    },
  ),
)
