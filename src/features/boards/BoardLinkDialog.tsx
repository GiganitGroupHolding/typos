import { useState } from "react"
import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { boardLinkUrl, type BoardNode } from "./model"

export function BoardLinkDialog({
  node,
  onClose,
  onSave,
}: {
  node?: BoardNode
  onClose: () => void
  onSave: (url: string, label: string) => void
}) {
  const [error, setError] = useState(false)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle>{node ? "Редактировать ссылку" : "Добавить ссылку"}</DialogTitle>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const values = new FormData(e.currentTarget)
            const url = boardLinkUrl(String(values.get("url")))
            if (!url) return setError(true)
            onSave(url, String(values.get("label")).trim())
          }}
        >
          <label className="grid gap-1">
            URL
            <Input name="url" placeholder="https://…" inputMode="url" defaultValue={node?.url} aria-invalid={error} />
          </label>
          {error && <p role="alert">Введите действительный адрес, начинающийся с http:// или https://.</p>}
          <label className="grid gap-1">
            Подпись
            <Input name="label" defaultValue={node?.label} />
          </label>
          <Button type="submit" className="justify-self-end">
            {node ? "Сохранить" : "Добавить"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
