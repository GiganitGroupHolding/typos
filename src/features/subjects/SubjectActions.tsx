import { GraduationCap, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useNavigate } from "react-router"
import { Button } from "@/components/ui/Button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu"
import { toastUndo } from "@/lib/undo"
import type { Subject } from "@/types"
import { useVault } from "@/vault/store"
import { openEditSubject } from "./NewSubjectDialog"

export function SubjectActions({ subject }: { subject: Subject }) {
  const navigate = useNavigate()

  const remove = async () => {
    const undo = await useVault.getState().trashSubject(subject.id)
    navigate("/")
    toastUndo(`Предмет «${subject.name}» в корзине`, undo, () => navigate(`/s/${subject.id}`))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Действия с предметом «${subject.name}»`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate(`/s/${subject.id}/review`)}>
          <GraduationCap /> Повторение закрепа
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openEditSubject(subject.id)}>
          <Pencil /> Название, цвет, иконка
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={remove}>
          <Trash2 /> Удалить предмет
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
