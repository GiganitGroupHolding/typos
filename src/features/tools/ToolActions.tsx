import { Download, MoreHorizontal, Pencil, PictureInPicture2, Trash2 } from "lucide-react"
import { useNavigate } from "react-router"
import { useUi } from "@/app/store"
import { Button } from "@/components/ui/Button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu"
import { toastUndo } from "@/lib/undo"
import { cn } from "@/lib/utils"
import type { Tool } from "@/types"
import { useVault } from "@/vault/store"
import { downloadProjectFile } from "./projectFiles"
import { openToolDialog } from "./ToolDialog"

export function ToolActions({ tool, className, onOpenWindow }: { tool: Tool; className?: string; onOpenWindow?: () => void }) {
  const openWindow = useUi((s) => s.openWindow)
  const closeWindow = useUi((s) => s.closeWindow)
  const navigate = useNavigate()

  const remove = async () => {
    closeWindow(`tool:${tool.id}`)
    const undo = await useVault.getState().trashTool(tool.id)
    if (location.pathname.includes(`/t/${tool.id}`)) navigate(`/s/${tool.subjectId}?tab=tools`)
    toastUndo(`«${tool.name}» в корзине`, undo)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Действия: ${tool.name}`}
          className={cn(className)}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            openWindow("tool", tool.id)
            onOpenWindow?.()
          }}
        >
          <PictureInPicture2 /> В окне поверх
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openToolDialog({ subjectId: tool.subjectId, toolId: tool.id })}>
          <Pencil /> {tool.kind === "html" ? "Название и иконка" : "Переименовать"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void downloadProjectFile(tool)}>
          <Download /> Скачать оригинал
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={remove}>
          <Trash2 /> Удалить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
