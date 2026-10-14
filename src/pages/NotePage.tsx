import { motion } from 'motion/react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { NoteEditor } from '@/editor/NoteEditor'
import { pageEnter } from '@/lib/motion'
import { useNote, useSubject } from '@/vault/hooks'

export function NotePage() {
  const { subjectId, noteId } = useParams()
  const [params] = useSearchParams()
  const note = useNote(noteId)
  const subject = useSubject(subjectId)
  if (!subject) return <Navigate to="/" replace />
  if (!note || note.subjectId !== subject.id) return <Navigate to={`/s/${subject.id}`} replace />

  return (
    <motion.div {...pageEnter} key={note.id} className="min-h-full">
      <NoteEditor key={note.id} note={note} autoFocus={params.has('new')} />
    </motion.div>
  )
}
