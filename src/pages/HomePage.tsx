import { FolderPlus } from "lucide-react"
import { motion } from "motion/react"
import { type ReactNode } from "react"
import { Link } from "react-router"
import { LiquidButton } from "@/components/ui/LiquidButton"
import { LensBox, useLiquidLens } from "@/components/ui/LiquidLens"
import { CARD_LENS } from "@/components/ui/liquidLensOptions"
import { openNewSubject } from "@/features/subjects/NewSubjectDialog"
import { SubjectBadge, subjectStyle } from "@/features/subjects/visuals"
import { plural, relativeTime } from "@/lib/format"
import { listItem, listParent, pageEnter } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Subject } from "@/types"
import { useRecentNotes, useSubjects } from "@/vault/hooks"
import { useVault } from "@/vault/store"

function SubjectCard({ subject: s, children }: { subject: Subject; children: ReactNode }) {
  const lens = useLiquidLens(CARD_LENS)
  return (
    <Link
      ref={lens.attach}
      to={`/s/${s.id}`}
      style={{ ...subjectStyle(s), ...lens.style }}
      className={cn(
        lens.className,
        "group block h-full rounded-[var(--radius-surface)] p-5 outline-none transition-transform duration-(--dur-base) ease-(--ease-out) hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
      )}
    >
      {lens.extras}
      {children}
    </Link>
  )
}

export function HomePage() {
  const subjects = useSubjects()
  const recent = useRecentNotes(5)
  const notes = useVault((s) => s.notes)
  const count = (xs: { subjectId: string }[], id: string) => xs.filter((x) => x.subjectId === id).length
  const subjectOf = (id: string) => subjects.find((s) => s.id === id)
  return (
    <motion.div {...pageEnter} className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <h1 className="text-[32px] leading-tight font-bold tracking-tight">Предметы</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">{plural(subjects.length, ["предмет", "предмета", "предметов"])}</p>

      {!subjects.length && (
        <div className="mt-8 rounded-3xl border border-dashed px-6 py-14 text-center">
          <p className="text-[17px] font-semibold">Нет предметов</p>
          <LiquidButton size="xl" className="mt-6 rounded-full font-semibold" onClick={openNewSubject}>
            <FolderPlus /> Новый предмет
          </LiquidButton>
        </div>
      )}

      <motion.ul
        variants={listParent}
        initial="hidden"
        animate="show"
        className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {subjects.map((s) => (
          <motion.li key={s.id} variants={listItem}>
            <SubjectCard subject={s}>
              <SubjectBadge subject={s} size="lg" />
              <div className="mt-4 text-[17px] font-semibold tracking-tight">{s.name}</div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                {plural(count(notes, s.id), ["конспект", "конспекта", "конспектов"])}
              </div>
              <div
                aria-hidden
                className="mt-4 h-1 w-10 origin-left rounded-full bg-(--subject) transition-transform duration-(--dur-slow) ease-(--ease-out) group-hover:scale-x-150"
              />
            </SubjectCard>
          </motion.li>
        ))}
      </motion.ul>

      {!!recent.length && <h2 className="mt-12 mb-3 text-[20px] font-semibold tracking-tight">Недавние</h2>}
      {!!recent.length && (
        <LensBox lens={CARD_LENS} className="rounded-[var(--radius-surface)]">
          <motion.ul
            variants={listParent}
            initial="hidden"
            animate="show"
            className="divide-y rounded-[inherit] [&>li:first-child>a]:rounded-t-[inherit] [&>li:last-child>a]:rounded-b-[inherit] [&>li]:rounded-[inherit]"
          >
            {recent.map((n) => {
              const s = subjectOf(n.subjectId)
              if (!s) return null
              return (
                <motion.li key={n.id} variants={listItem}>
                  <Link
                    to={`/s/${s.id}/n/${n.id}`}
                    className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <SubjectBadge subject={s} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{n.title || "Без названия"}</div>
                      <div className="truncate text-[13px] text-muted-foreground">{n.excerpt}</div>
                    </div>
                    <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{relativeTime(n.updated)}</span>
                  </Link>
                </motion.li>
              )
            })}
          </motion.ul>
        </LensBox>
      )}
    </motion.div>
  )
}
