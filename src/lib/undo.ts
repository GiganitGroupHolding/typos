import { toast } from 'sonner'

export function toastUndo(message: string, undo: () => Promise<void>, after?: () => void) {
  toast(message, {
    duration: 8000,
    action: {
      label: 'Отменить',
      onClick: () => {
        undo()
          .then(after)
          .catch((e) => toast.error('Не удалось восстановить', { description: e instanceof Error ? e.message : String(e) }))
      },
    },
  })
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function submitOnCtrlEnter(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    e.currentTarget.requestSubmit()
  }
}
