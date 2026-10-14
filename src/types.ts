export type SubjectColor =
  | 'red'
  | 'orange'
  | 'amber'
  | 'lime'
  | 'green'
  | 'teal'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'brown'
  | 'slate'

export type SubjectIcon =
  | 'sigma'
  | 'chart'
  | 'atom'
  | 'flask'
  | 'dna'
  | 'stethoscope'
  | 'brain'
  | 'telescope'
  | 'globe'
  | 'code'
  | 'cpu'
  | 'cog'
  | 'trending'
  | 'coins'
  | 'megaphone'
  | 'briefcase'
  | 'target'
  | 'handshake'
  | 'presentation'
  | 'users'
  | 'scale'
  | 'landmark'
  | 'lightbulb'
  | 'feather'
  | 'languages'
  | 'palette'
  | 'music'
  | 'dumbbell'
  | 'graduation'
  | 'book'

/** Предмет = папка в vault + `_subject.json`. */
export interface Subject {
  id: string
  name: string
  color: SubjectColor
  icon: SubjectIcon
  order: number
  /** Папка предмета относительно корня vault. */
  dir: string
}

/** Конспект = `<Предмет>/Конспекты/<Заголовок>.md` с frontmatter. */
export interface Note {
  id: string
  subjectId: string
  path: string
  title: string
  created: string // ISO
  updated: string // ISO
  excerpt: string
  /** Markdown без frontmatter. Первая строка — заголовок (как в Apple Notes). */
  body: string
  /** Прочие ключи frontmatter — сохраняем как есть. */
  meta: Record<string, string>
}

/** Карточка закрепа = `<Предмет>/Закреп/<Название>.md`. */
export interface Pin {
  id: string
  subjectId: string
  path: string
  title: string
  tex?: string
  text?: string
  order: number
}

export type ToolIcon = 'grid' | 'chart' | 'ruler' | 'binary' | 'calculator' | 'function' | 'timer' | 'table'

/** Тулза = `<Предмет>/Инструменты/<Название>.html`. */
export interface Tool {
  id: string
  subjectId: string
  path: string
  name: string
  icon: ToolIcon
  html: string
}

export type SubjectTab = 'notes' | 'pins' | 'tools'
