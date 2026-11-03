import { toast } from "sonner"
import { errorText } from "@/lib/errors"

export function toastUndo(message: string, undo: () => Promise<void>, after?: () => void) {
  toast(message, {
    duration: 8000,
    action: {
      label: "Отменить",
      onClick: () => {
        undo()
          .then(after)
          .catch((e) => toast.error("Не удалось восстановить", { description: errorText(e) }))
      },
    },
  })
}
