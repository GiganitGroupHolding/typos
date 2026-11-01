export type TemplateId = 'blank' | 'lecture' | 'seminar'

const today = () => new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(new Date())

export const templates: { id: TemplateId; label: string; hint: string; body: () => string }[] = [
  { id: 'blank', label: 'Пустой', hint: 'Чистый лист', body: () => '' },
  {
    id: 'lecture',
    label: 'Лекция',
    hint: 'Тема, конспект, вопросы',
    body: () => `# Лекция ${today()}\n\n**Тема:** \n\n## Конспект\n\n\n\n## Непонятно / спросить\n\n- [ ] \n`,
  },
  {
    id: 'seminar',
    label: 'Семинар',
    hint: 'Задачи и разбор',
    body: () => `# Семинар ${today()}\n\n## Задача 1\n\n**Условие:** \n\n**Решение:** \n\n## Домашка\n\n- [ ] \n`,
  },
]
