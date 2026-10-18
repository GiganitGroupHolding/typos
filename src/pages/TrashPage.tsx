import { FileText, Folder, Loader2, Pin, RotateCcw, Trash2, Wrench, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { plural, relativeTime } from '@/lib/format'
import { listItem, listParent, pageEnter } from '@/lib/motion'
import { errorText } from '@/lib/undo'
import type { TrashItem, TrashKind } from '@/vault/repo'
import { useVault } from '@/vault/store'

const KIND: Record<TrashKind, { icon: LucideIcon; label: string }> = {
  note: { icon: FileText, label: 'Конспект' },
  pin: { icon: Pin, label: 'Карточка закрепа' },
  tool: { icon: Wrench, label: 'Тулза' },
  subject: { icon: Folder, label: 'Предмет целиком' },
  file: { icon: FileText, label: 'Файл' },
}

/** Корзина: всё удалённое за 30 дней. Восстановление — на прежнее место. */
export function TrashPage() {
  const listTrash = useVault((s) => s.listTrash)
  const restoreTrash = useVault((s) => s.restoreTrash)
  const deleteForever = useVault((s) => s.deleteForever)
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [confirm, setConfirm] = useState<TrashItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listTrash().then(setItems, (e) => {
      setItems([])
      toast.error('Не удалось открыть корзину', { description: errorText(e) })
    })
  }, [listTrash])
  useEffect(load, [load])

  const restore = async (item: TrashItem) => {
    try {
      await restoreTrash(item)
      toast.success(`«${item.name}» восстановлен`, { description: item.originalPath })
      load()
    } catch (e) {
      toast.error('Не удалось восстановить', { description: errorText(e) })
    }
  }

  const destroy = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      for (const item of confirm) await deleteForever(item)
      setConfirm(null)
      load()
    } catch (e) {
      toast.error('Не удалось удалить', { description: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div {...pageEnter} className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <header className="flex items-end gap-4">
        <div className="flex-1">
          <h1 className="text-[32px] leading-tight font-bold tracking-tight">Корзина</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Удалённое хранится 30 дней, потом исчезает само.</p>
        </div>
        {!!items?.length && (
          <Button variant="outline" onClick={() => setConfirm(items)}>
            <Trash2 /> Очистить
          </Button>
        )}
      </header>

      {items === null ? (
        <div className="mt-10 flex justify-center text-muted-foreground" aria-busy="true">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : !items.length ? (
        <p className="mt-8 rounded-3xl border border-dashed px-6 py-14 text-center text-[15px] text-muted-foreground">Корзина пуста</p>
      ) : (
        <motion.ul
          variants={listParent}
          initial="hidden"
          animate="show"
          className="mt-8 divide-y overflow-hidden rounded-2xl border bg-card shadow-card"
        >
          {items.map((item) => {
            const { icon: Icon, label } = KIND[item.kind]
            return (
              <motion.li key={item.trashPath} variants={listItem} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{item.name}</div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {label} · {item.originalPath.split('/')[0]} · удалено {relativeTime(item.deletedAt)}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => restore(item)}>
                  <RotateCcw /> Вернуть
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Удалить «${item.name}» навсегда`} onClick={() => setConfirm([item])}>
                  <Trash2 />
                </Button>
              </motion.li>
            )
          })}
        </motion.ul>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить навсегда?</DialogTitle>
            <DialogDescription>
              {confirm?.length === 1
                ? `«${confirm[0].name}» исчезнет с диска.`
                : `Все ${plural(confirm?.length ?? 0, ['объект', 'объекта', 'объектов'])} исчезнут с диска.`}{' '}
              Это нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={busy} onClick={destroy}>
              Удалить навсегда
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
