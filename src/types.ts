import type { BoardData } from "@/features/boards/model"

export type SubjectColor =
  | "red"
  | "orange"
  | "amber"
  | "lime"
  | "green"
  | "teal"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "fuchsia"
  | "pink"
  | "rose"
  | "brown"
  | "slate"

export type SubjectIcon =
  | "sigma"
  | "chart"
  | "atom"
  | "flask"
  | "dna"
  | "stethoscope"
  | "brain"
  | "telescope"
  | "globe"
  | "code"
  | "cpu"
  | "cog"
  | "trending"
  | "coins"
  | "megaphone"
  | "briefcase"
  | "target"
  | "handshake"
  | "presentation"
  | "users"
  | "scale"
  | "landmark"
  | "lightbulb"
  | "feather"
  | "languages"
  | "palette"
  | "music"
  | "dumbbell"
  | "graduation"
  | "book"

export interface Subject {
  id: string
  name: string
  color: SubjectColor
  icon: SubjectIcon
  order: number

  dir: string
}

export interface Note {
  id: string
  subjectId: string
  path: string
  title: string
  created: string
  updated: string
  excerpt: string

  body: string

  meta: Record<string, string>

  mapText?: string
}

export interface Pin {
  id: string
  subjectId: string
  path: string
  title: string
  tex?: string
  text?: string
  order: number
}

export type ToolIcon = "grid" | "chart" | "ruler" | "binary" | "calculator" | "function" | "timer" | "table"

export type ToolKind = "html" | "image" | "pdf" | "docx" | "pptx" | "text" | "video" | "audio" | "other"

export interface Tool {
  id: string
  subjectId: string
  path: string
  name: string
  kind: ToolKind

  ext: string

  icon: ToolIcon

  html: string
  size?: number
}

export interface Board {
  id: string
  subjectId: string
  path: string
  name: string
  data: BoardData
}

export type SubjectTab = "notes" | "pins" | "tools" | "boards"
