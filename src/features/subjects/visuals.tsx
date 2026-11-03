import {
  Atom,
  Binary,
  BookOpen,
  Brain,
  Briefcase,
  Calculator,
  ChartPie,
  ChartSpline,
  Code2,
  Cog,
  Coins,
  Cpu,
  Dna,
  Dumbbell,
  Feather,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FlaskConical,
  Globe,
  GraduationCap,
  Grid3x3,
  Handshake,
  Landmark,
  Languages,
  Lightbulb,
  Megaphone,
  Music,
  Palette,
  Presentation,
  Ruler,
  Scale,
  Sigma,
  SquareFunction,
  Stethoscope,
  Table2,
  Target,
  Telescope,
  Timer,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react"
import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import type { Subject, SubjectIcon, Tool, ToolIcon, ToolKind } from "@/types"

export const subjectIcons: Record<SubjectIcon, LucideIcon> = {
  sigma: Sigma,
  chart: ChartPie,
  atom: Atom,
  flask: FlaskConical,
  dna: Dna,
  stethoscope: Stethoscope,
  brain: Brain,
  telescope: Telescope,
  globe: Globe,
  code: Code2,
  cpu: Cpu,
  cog: Cog,
  trending: TrendingUp,
  coins: Coins,
  megaphone: Megaphone,
  briefcase: Briefcase,
  target: Target,
  handshake: Handshake,
  presentation: Presentation,
  users: Users,
  scale: Scale,
  landmark: Landmark,
  lightbulb: Lightbulb,
  feather: Feather,
  languages: Languages,
  palette: Palette,
  music: Music,
  dumbbell: Dumbbell,
  graduation: GraduationCap,
  book: BookOpen,
}

export const toolIcons: Record<ToolIcon, LucideIcon> = {
  grid: Grid3x3,
  chart: ChartSpline,
  ruler: Ruler,
  binary: Binary,
  calculator: Calculator,
  function: SquareFunction,
  timer: Timer,
  table: Table2,
}

export const toolIconLabels: Record<ToolIcon, string> = {
  grid: "Матрица",
  chart: "График",
  ruler: "Единицы",
  binary: "Алгоритм",
  calculator: "Калькулятор",
  function: "Функция",
  timer: "Таймер",
  table: "Таблица",
}

const kindIcons: Record<Exclude<ToolKind, "html">, LucideIcon> = {
  image: FileImage,
  pdf: FileText,
  docx: FileText,
  pptx: Presentation,
  text: FileText,
  video: FileVideo,
  audio: FileAudio,
  other: File,
}

export const toolIcon = (t: Pick<Tool, "kind" | "icon">): LucideIcon => (t.kind === "html" ? toolIcons[t.icon] : kindIcons[t.kind])

export const kindLabels: Record<ToolKind, string> = {
  html: "HTML",
  image: "Картинка",
  pdf: "PDF",
  docx: "Документ Word",
  pptx: "Презентация",
  text: "Текст",
  video: "Видео",
  audio: "Аудио",
  other: "Файл",
}

export const subjectColor = (s: Pick<Subject, "color">) => `var(--subject-${s.color})`

export const subjectStyle = (s: Pick<Subject, "color">) => ({ "--subject": subjectColor(s) }) as CSSProperties

export function SubjectBadge({ subject, size = "md", className }: { subject: Subject; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = subjectIcons[subject.icon]
  return (
    <span
      aria-hidden
      style={subjectStyle(subject)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[28%] bg-(--subject)/14 text-(--subject)",
        size === "sm" && "size-6 [&_svg]:size-3.5",
        size === "md" && "size-8 [&_svg]:size-4",
        size === "lg" && "size-12 [&_svg]:size-6",
        className,
      )}
    >
      <Icon strokeWidth={2} />
    </span>
  )
}
