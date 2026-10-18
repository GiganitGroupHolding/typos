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
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { Subject, SubjectIcon, ToolIcon } from '@/types'

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
  grid: 'Матрица',
  chart: 'График',
  ruler: 'Единицы',
  binary: 'Алгоритм',
  calculator: 'Калькулятор',
  function: 'Функция',
  timer: 'Таймер',
  table: 'Таблица',
}

/** CSS-переменная цвета предмета, для `style`. */
export const subjectColor = (s: Pick<Subject, 'color'>) => `var(--subject-${s.color})`

export const subjectStyle = (s: Pick<Subject, 'color'>) => ({ '--subject': subjectColor(s) }) as CSSProperties

/** Иконка предмета в цветной плашке. Цвет — не единственный признак: всегда есть иконка. */
export function SubjectBadge({ subject, size = 'md', className }: { subject: Subject; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = subjectIcons[subject.icon]
  return (
    <span
      aria-hidden
      style={subjectStyle(subject)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[28%] bg-(--subject)/14 text-(--subject)',
        size === 'sm' && 'size-6 [&_svg]:size-3.5',
        size === 'md' && 'size-8 [&_svg]:size-4',
        size === 'lg' && 'size-12 [&_svg]:size-6',
        className,
      )}
    >
      <Icon strokeWidth={2} />
    </span>
  )
}
