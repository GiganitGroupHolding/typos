import type { BoardData } from '@/features/boards/model'

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
  /** Тексты блоков мини-карты (для поиска); сама карта — в .maps/<id>.json. */
  mapText?: string
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

/** Что за файл в «Проектах» — от этого зависит, чем его показывать. */
export type ToolKind = 'html' | 'image' | 'pdf' | 'docx' | 'pptx' | 'text' | 'video' | 'audio' | 'other'

/**
 * Файл в «Проектах» = `<Предмет>/Проекты/<Название>.<ext>` (старое место — `Инструменты/`).
 * HTML — интерактивная тулза в песочнице (id и иконка — в <meta>), остальное — документы, картинки, PDF…
 */
export interface Tool {
  id: string
  subjectId: string
  path: string
  name: string
  kind: ToolKind
  /** расширение без точки, в нижнем регистре */
  ext: string
  /** иконка — только у HTML; у остальных — по типу файла */
  icon: ToolIcon
  /** код страницы — только у HTML; содержимое остальных грузится, когда файл открыт */
  html: string
  size?: number
}

/** Доска = `<Предмет>/Доски/<Название>.canvas` (JSON Canvas, как в Obsidian). */
export interface Board {
  id: string
  subjectId: string
  path: string
  name: string
  data: BoardData
}

export type SubjectTab = 'notes' | 'pins' | 'tools' | 'boards'
