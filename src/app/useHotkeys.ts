import { useEffect, useRef } from 'react'
import { useParams } from 'react-router'
import { useCreateNote } from '@/vault/hooks'
import { useUi } from './store'

export function useHotkeys() {
  const createNote = useCreateNote()
  const { subjectId } = useParams()
  const ctx = useRef({ createNote, subjectId })
  useEffect(() => {
    ctx.current = { createNote, subjectId }
  }, [createNote, subjectId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const ui = useUi.getState()
      const ctrl = e.ctrlKey || e.metaKey
      if (e.code === 'KeyN' && ((e.altKey && !ctrl) || (ctrl && !e.altKey && !e.shiftKey))) {
        e.preventDefault()
        void ctx.current.createNote(ctx.current.subjectId)
        return
      }
      if (!ctrl || e.altKey) return
      if (e.code === 'KeyK') {
        e.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
      } else if (e.code === 'KeyJ') {
        e.preventDefault()
        ui.togglePins()
      } else if (e.code === 'Backslash') {
        e.preventDefault()
        ui.toggleFocus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
