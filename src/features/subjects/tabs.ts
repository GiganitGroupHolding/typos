import type { SubjectTab } from '@/types'

/** Раздел предмета по адресу без ?tab: открытый файл проекта или доска подсвечивают свой раздел. */
export const tabOfPath = (pathname: string): SubjectTab =>
  pathname.includes('/t/') ? 'tools' : pathname.includes('/b/') ? 'boards' : 'notes'
