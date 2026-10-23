import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorText, toastUndo } from '@/lib/undo'
import { cn } from '@/lib/utils'
import type { Board } from '@/types'
import { useVault } from '@/vault/store'

export function BoardActions({ board, className }: { board: Board; className?: string }) {
  const navigate = useNavigate()

  const remove = async () => {
    try {
      const undo = await useVault.getState().trashBoard(board.id)
      if (location.pathname.includes(`/b/${board.id}`)) navigate(`/s/${board.subjectId}?tab=boards`)
      toastUndo(`«${board.name}» в корзине`, undo)
    } catch (e) {
      toast.error('Не удалось удалить доску', { description: errorText(e) })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Действия: ${board.name}`}
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
        {/* название правится в шапке доски — открываем её с полем в фокусе */}
        <DropdownMenuItem onSelect={() => navigate(`/s/${board.subjectId}/b/${board.id}?rename=1`)}>
          <Pencil /> Переименовать
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={remove}>
          <Trash2 /> Удалить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
