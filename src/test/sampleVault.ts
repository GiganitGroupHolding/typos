import { createMemoryAdapter } from '@/storage/flatAdapter'

/** Набор файлов для тестов: несколько предметов в формате vault. Только для vitest. */

const meta = (id: string, color: string, icon: string, order: number) => JSON.stringify({ id, color, icon, order })
const note = (id: string, daysAgo: number, body: string) => {
  const iso = new Date(Date.now() - daysAgo * 864e5).toISOString()
  return `---\nid: ${id}\ncreated: ${iso}\nupdated: ${iso}\n---\n\n${body}`
}
const pin = (id: string, order: number, title: string, tex: string, text?: string) =>
  `---\nid: ${id}\norder: ${order}\n---\n\n# ${title}\n\n$$\n${tex}\n$$\n${text ? `\n${text}\n` : ''}`
const tool = (title: string, icon: string) =>
  `<!doctype html><html><head><meta name="studynotes-icon" content="${icon}"><title>${title}</title></head><body>${title}</body></html>`

const LA = 'Линейная алгебра'
const PH = 'Физика'
const AL = 'Алгоритмы'
const HI = 'История'

export const sampleFiles: Record<string, string> = {
  [`${LA}/_subject.json`]: meta('la', 'amber', 'sigma', 0),
  [`${LA}/Конспекты/Матрицы и операции над ними.md`]: note(
    'n-matrices',
    0.1,
    '# Матрицы и операции над ними\n\nМатрица размера $m \\times n$.\n\n> Важно: в общем случае $AB \\neq BA$. Умножение **не коммутативно**, но ассоциативно.',
  ),
  [`${LA}/Конспекты/Определители.md`]: note(
    'n-det',
    2,
    '# Определители\n\nМатрица обратима, если $\\det A \\neq 0$.\n\n1. $\\det A^T = \\det A$',
  ),
  [`${LA}/Конспекты/Собственные значения.md`]: note('n-eigen', 6, '# Собственные значения\n\n$$\n\\det(A - \\lambda I) = 0\n$$'),
  [`${LA}/Закреп/Определитель 2×2.md`]: pin('p-det2', 0, 'Определитель 2×2', '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc'),
  [`${LA}/Закреп/Обратная матрица.md`]: pin(
    'p-inv',
    1,
    'Обратная матрица',
    'A^{-1} = \\frac{1}{\\det A} \\operatorname{adj} A',
    'Существует только при det A ≠ 0',
  ),
  [`${LA}/Инструменты/Калькулятор матриц.html`]: tool('Калькулятор матриц', 'grid'),
  [`${LA}/Инструменты/График функции.html`]: tool('График функции', 'chart'),

  [`${PH}/_subject.json`]: meta('ph', 'blue', 'atom', 1),
  [`${PH}/Конспекты/Кинематика точки.md`]: note('n-kin', 1.2, '# Кинематика точки\n\n$$\nx(t) = x_0 + v_0 t + \\frac{a t^2}{2}\n$$'),
  [`${PH}/Конспекты/Законы Ньютона.md`]: note(
    'n-newton',
    4,
    '# Законы Ньютона\n\n1. Существуют инерциальные системы отсчёта.\n2. Второй закон: $\\vec F = m\\vec a$.',
  ),
  [`${PH}/Закреп/Второй закон Ньютона.md`]: pin('p-newton2', 0, 'Второй закон Ньютона', '\\vec F = m \\vec a'),
  [`${PH}/Инструменты/Конвертер единиц.html`]: tool('Конвертер единиц', 'ruler'),

  [`${AL}/_subject.json`]: meta('al', 'violet', 'code', 2),
  [`${AL}/Конспекты/Асимптотика и O-нотация.md`]: note(
    'n-bigo',
    3,
    '# Асимптотика и O-нотация\n\n- Бинарный поиск — $O(\\log n)$\n- Пузырёк — $O(n^2)$',
  ),
  [`${AL}/Закреп/Мастер-теорема.md`]: pin('p-master', 0, 'Мастер-теорема', 'T(n) = a T(n/b) + f(n)'),

  [`${HI}/_subject.json`]: meta('hi', 'rose', 'landmark', 3),
  [`${HI}/Конспекты/Реформы Петра I.md`]: note('n-peter', 9, '# Реформы Петра I\n\n- **1711** — учреждение Сената'),
}

export const sampleVault = () => createMemoryAdapter({ ...sampleFiles })
