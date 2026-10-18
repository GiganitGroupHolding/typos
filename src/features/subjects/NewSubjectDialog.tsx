import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SUBJECT_COLORS, SUBJECT_ICONS } from '@/lib/subjectPalette'
import { cn } from '@/lib/utils'
import type { SubjectColor, SubjectIcon } from '@/types'
import { useVault } from '@/vault/store'
import { SubjectBadge, subjectIcons } from './visuals'

/** Открыть диалог можно откуда угодно: openNewSubject() / openEditSubject(id). */
const useDialog = create<{ open: boolean; editId?: string; set: (v: boolean, editId?: string) => void }>((set) => ({
  open: false,
  set: (open, editId) => set({ open, editId }),
}))
export const openNewSubject = () => useDialog.getState().set(true)
export const openEditSubject = (id: string) => useDialog.getState().set(true, id)

export function NewSubjectDialog() {
  const open = useDialog((s) => s.open)
  const editId = useDialog((s) => s.editId)
  const setOpen = (v: boolean) => useDialog.getState().set(v, v ? editId : undefined)
  const editing = useVault((s) => s.subjects.find((x) => x.id === editId))
  const createSubject = useVault((s) => s.createSubject)
  const updateSubject = useVault((s) => s.updateSubject)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [color, setColor] = useState<SubjectColor>('blue')
  const [icon, setIcon] = useState<SubjectIcon>('book')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setColor(editing?.color ?? 'blue')
    setIcon(editing?.icon ?? 'book')
  }, [open, editing])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      if (editing) {
        await updateSubject(editing.id, { name: name.trim(), color, icon })
        setOpen(false)
      } else {
        const s = await createSubject({ name: name.trim(), color, icon })
        setOpen(false)
        navigate(`/s/${s.id}`)
      }
    } catch (err) {
      toast.error(editing ? 'Не удалось сохранить предмет' : 'Не удалось создать предмет', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editing ? 'Предмет' : 'Новый предмет'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Новое название станет и именем папки на диске.' : 'На диске появится папка с этим названием.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3">
            <SubjectBadge subject={{ id: '', name, color, icon, order: 0, dir: '' }} size="lg" />
            <div className="flex-1">
              <label htmlFor="subject-name" className="mb-1 block text-[13px] font-medium">
                Название
              </label>
              <Input
                id="subject-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Матанализ"
                maxLength={80}
              />
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Цвет</legend>
            <div className="flex flex-wrap gap-2">
              {SUBJECT_COLORS.map(({ id: c, name: colorName }) => (
                <button
                  key={c}
                  type="button"
                  aria-label={colorName}
                  title={colorName}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  style={{ background: `var(--subject-${c})` }}
                  className={cn(
                    'size-8 rounded-full outline-none transition-transform duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95',
                    color === c && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
                  )}
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Иконка</legend>
            <div className="flex flex-wrap gap-2">
              {SUBJECT_ICONS.map(({ id: i, label }) => {
                const Icon = subjectIcons[i]
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={icon === i}
                    onClick={() => setIcon(i)}
                    className={cn(
                      'flex size-10 items-center justify-center rounded-xl border outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
                      icon === i
                        ? 'border-highlight bg-accent text-highlight'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                  </button>
                )
              })}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {editing ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
