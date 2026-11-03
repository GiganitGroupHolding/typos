import { Download, PictureInPicture2, RotateCw, Smartphone } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"
import { Navigate, useNavigate, useParams } from "react-router"
import { useUi } from "@/app/store"
import { Button } from "@/components/ui/Button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip"
import { kindLabels, toolIcon } from "@/features/subjects/visuals"
import { PhonePreview } from "@/features/tools/PhonePreview"
import { downloadProjectFile } from "@/features/tools/projectFiles"
import { ProjectViewer } from "@/features/tools/ProjectViewer"
import { ToolActions } from "@/features/tools/ToolActions"
import { fileSize } from "@/lib/format"
import { pageEnter } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { useSubject, useTool } from "@/vault/hooks"

export function ToolPage() {
  const { subjectId, toolId } = useParams()
  const tool = useTool(toolId)
  const subject = useSubject(subjectId)
  const [runKey, setRunKey] = useState(0)
  const openWindow = useUi((s) => s.openWindow)
  const phone = useUi((s) => s.phonePreview)
  const togglePhone = useUi((s) => s.togglePhone)
  const navigate = useNavigate()
  if (!tool || !subject || tool.subjectId !== subject.id) return <Navigate to={subject ? `/s/${subject.id}?tab=tools` : "/"} replace />

  const Icon = toolIcon(tool)
  const isHtml = tool.kind === "html"
  const inPhone = isHtml && phone

  return (
    <motion.div {...pageEnter} key={tool.id} className="flex h-full flex-col p-3 pt-2">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className="size-4 shrink-0 text-highlight" />
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{tool.name}</h1>
        {!isHtml && (
          <span className="hidden gap-2 px-2 text-[12px] text-muted-foreground sm:inline-flex">
            <span>{kindLabels[tool.kind]}</span>
            {tool.size !== undefined && <span>{fileSize(tool.size)}</span>}
          </span>
        )}
        {isHtml && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={phone}
              onClick={togglePhone}
              className={cn(phone && "bg-accent text-highlight")}
            >
              <Smartphone /> Телефон
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRunKey((k) => k + 1)}>
              <RotateCw /> Перезапустить
            </Button>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Скачать" onClick={() => void downloadProjectFile(tool)}>
              <Download />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Скачать</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            openWindow("tool", tool.id)
            navigate(`/s/${subject.id}`)
          }}
        >
          <PictureInPicture2 /> В отдельном окне
        </Button>
        <ToolActions tool={tool} onOpenWindow={() => navigate(`/s/${subject.id}`)} />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-hidden", !inPhone && "rounded-2xl border bg-background shadow-card")}>
        {inPhone ? <PhonePreview html={tool.html} title={tool.name} runKey={runKey} /> : <ProjectViewer tool={tool} runKey={runKey} />}
      </div>
    </motion.div>
  )
}
