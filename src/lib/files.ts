/** Системный выбор файлов. [] — пользователь передумал. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

/** .md и простой текст — становятся конспектами. */
export const isMarkdownFile = (f: File) => /\.(md|markdown|mdown|txt)$/i.test(f.name) || f.type === 'text/markdown'
export const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(f.name)

/** Картинки по имени файла (нижний регистр, NFC) — для ссылок ![](x.png) в импортируемом .md. */
export const imagesByName = (files: File[]) =>
  new Map<string, Blob>(files.filter(isImageFile).map((f) => [f.name.normalize('NFC').toLowerCase(), f]))
