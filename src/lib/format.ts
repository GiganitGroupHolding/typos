const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' })

export function relativeTime(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'только что'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day')
  return dateFmt.format(new Date(iso))
}

/** 1,4 МБ, 230 КБ. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const [v, unit] = bytes < 1024 ** 2 ? [bytes / 1024, 'КБ'] : bytes < 1024 ** 3 ? [bytes / 1024 ** 2, 'МБ'] : [bytes / 1024 ** 3, 'ГБ']
  return `${v.toLocaleString('ru', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${unit}`
}

export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10,
    m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

/** «папка …» → «Папка …» для начала строки. */
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h < 5) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}
