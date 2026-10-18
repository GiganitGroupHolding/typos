import { PictureInPicture2, RotateCw, ShieldCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useUi } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toolIcons } from '@/features/subjects/visuals'
import { ToolActions } from '@/features/tools/ToolActions'
import { ToolFrame } from '@/features/tools/ToolFrame'
import { pageEnter } from '@/lib/motion'
import { useSubject, useTool } from '@/vault/hooks'

export function ToolPage() {
  const { subjectId, toolId } = useParams()
  const tool = useTool(toolId)
  const subject = useSubject(subjectId)
  const [runKey, setRunKey] = useState(0)
  const openWindow = useUi((s) => s.openWindow)
  const navigate = useNavigate()
  if (!tool || !subject || tool.subjectId !== subject.id) return <Navigate to={subject ? `/s/${subject.id}?tab=tools` : '/'} replace />

  const Icon = toolIcons[tool.icon]

  return (
    <motion.div {...pageEnter} key={tool.id} className="flex h-full flex-col p-3 pt-2">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className="size-4 text-highlight" />
        <h1 className="flex-1 truncate text-[15px] font-semibold">{tool.name}</h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Изолировано
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            Тулза работает в песочнице: без доступа к твоим конспектам, хранилищу браузера и сети.
          </TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={() => setRunKey((k) => k + 1)}>
          <RotateCw /> Перезапустить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            openWindow('tool', tool.id)
            navigate(`/s/${subject.id}`)
          }}
        >
          <PictureInPicture2 /> В окно
        </Button>
        <ToolActions tool={tool} onOpenWindow={() => navigate(`/s/${subject.id}`)} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border shadow-card">
        <ToolFrame html={tool.html} title={tool.name} runKey={runKey} />
      </div>
    </motion.div>
  )
}
