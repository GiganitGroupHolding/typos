import { ArrowLeft, Check, RotateCcw, Shuffle, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { SubjectBadge, subjectStyle } from '@/features/subjects/visuals'
import { plural } from '@/lib/format'
import { dur, easeIn, easeOut, pageEnter, spring } from '@/lib/motion'
import { Tex } from '@/lib/tex'
import type { Pin } from '@/types'
import { usePinsOf, useSubject } from '@/vault/hooks'

export function ReviewPage() {
  const { subjectId } = useParams()
  const subject = useSubject(subjectId)
  const pins = usePinsOf(subjectId)
  const [round, setRound] = useState(0)
  const [shuffled, setShuffled] = useState(false)

  if (!subject) return <Navigate to="/" replace />
  if (!pins.length)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-[17px] font-semibold">Повторять пока нечего</p>
        <p className="text-sm text-muted-foreground">Добавь карточки в закреп предмета «{subject.name}».</p>
        <Button variant="outline" asChild>
          <Link to={`/s/${subject.id}?tab=pins`}>К закрепу</Link>
        </Button>
      </div>
    )

  return (
    <motion.div {...pageEnter} style={subjectStyle(subject)} className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild aria-label="Назад к предмету">
          <Link to={`/s/${subject.id}`} viewTransition>
            <ArrowLeft />
          </Link>
        </Button>
        <SubjectBadge subject={subject} size="sm" />
        <h1 className="flex-1 truncate text-[17px] font-semibold">Повторение · {subject.name}</h1>
        <Button
          variant={shuffled ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={shuffled}
          onClick={() => {
            setShuffled((v) => !v)
            setRound((r) => r + 1)
          }}
        >
          <Shuffle /> Перемешать
        </Button>
      </header>
      <Session key={`${round}-${pins.map((p) => p.id).join()}`} pins={pins} shuffle={shuffled} onRestart={() => setRound((r) => r + 1)} />
    </motion.div>
  )
}

function shuffleArr<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

function Session({ pins, shuffle, onRestart }: { pins: Pin[]; shuffle: boolean; onRestart: () => void }) {
  const initial = useMemo(() => (shuffle ? shuffleArr(pins) : pins), [pins, shuffle])
  const [queue, setQueue] = useState(initial)
  const [flipped, setFlipped] = useState(false)
  const [firstTry, setFirstTry] = useState(new Set<string>())
  const [missed, setMissed] = useState(new Set<string>())
  const total = pins.length
  const done = total - new Set(queue.map((p) => p.id)).size
  const card = queue[0]

  const answer = useCallback(
    (knew: boolean) => {
      if (!card) return
      setFlipped(false)
      if (knew) {
        if (!missed.has(card.id)) setFirstTry((s) => new Set(s).add(card.id))
        setQueue((q) => q.slice(1))
      } else {
        setMissed((s) => new Set(s).add(card.id))
        setQueue((q) => [...q.slice(1), q[0]])
      }
    },
    [card, missed],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        if (!flipped) setFlipped(true)
        else answer(true)
      } else if (flipped && (e.code === 'ArrowRight' || e.code === 'KeyJ')) answer(true)
      else if (flipped && (e.code === 'ArrowLeft' || e.code === 'KeyF')) answer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, answer])

  if (!card)
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1, transition: spring }}
        className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
      >
        <div className="flex size-16 items-center justify-center rounded-full bg-(--subject)/15 text-(--subject)">
          <Check className="size-8" />
        </div>
        <h2 className="text-[24px] font-bold tracking-tight">Круг пройден</h2>
        <p className="text-[15px] text-muted-foreground">
          С первого раза — {firstTry.size} из {plural(total, ['карточки', 'карточек', 'карточек'])}
        </p>
        <Button className="mt-2" onClick={onRestart}>
          <RotateCcw /> Ещё раз
        </Button>
      </motion.div>
    )

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3 text-[13px] text-muted-foreground tabular-nums">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <motion.div className="h-full origin-left rounded-full bg-(--subject)" animate={{ scaleX: done / total }} transition={spring} />
        </div>
        {done} / {total}
      </div>

      <div className="relative flex-1 [perspective:1200px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.button
            key={card.id + (missed.has(card.id) ? '-again' : '')}
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? 'Показать вопрос' : 'Показать ответ'}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0, transition: { duration: dur.slow, ease: easeOut } }}
            exit={{ opacity: 0, x: -40, transition: { duration: dur.base * 0.65, ease: easeIn } }}
            className="block h-full min-h-72 w-full rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <motion.div
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={spring}
              className="relative size-full min-h-72 [transform-style:preserve-3d]"
            >
              <Face>
                <span className="text-[13px] font-semibold tracking-wide text-(--subject) uppercase">Вспомни</span>
                <span className="mt-3 text-[28px] leading-tight font-bold tracking-tight">{card.title}</span>
                <span className="mt-6 text-[13px] text-muted-foreground">
                  Нажми или <Kbd>Пробел</Kbd>, чтобы перевернуть
                </span>
              </Face>
              <Face back>
                <span className="text-[15px] font-semibold">{card.title}</span>
                {card.tex && (
                  <div className="thin-scrollbar mt-4 max-w-full overflow-x-auto text-[22px]">
                    <Tex tex={card.tex} block />
                  </div>
                )}
                {card.text && <p className="mt-3 text-[15px] text-muted-foreground">{card.text}</p>}
              </Face>
            </motion.div>
          </motion.button>
        </AnimatePresence>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3" aria-hidden={!flipped}>
        <Button size="lg" variant="outline" disabled={!flipped} onClick={() => answer(false)}>
          <X /> Не помню <Kbd className="ml-1">←</Kbd>
        </Button>
        <Button size="lg" disabled={!flipped} onClick={() => answer(true)}>
          <Check /> Помню <Kbd className="ml-1">→</Kbd>
        </Button>
      </div>
    </div>
  )
}

function Face({ back, children }: { back?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl border bg-card p-8 text-center shadow-float [backface-visibility:hidden]"
      style={back ? { transform: 'rotateY(180deg)' } : undefined}
    >
      {children}
    </div>
  )
}
