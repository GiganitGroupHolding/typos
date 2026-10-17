/**
 * Код внутри песочницы просмотра DOCX / PPTX. Собирается отдельно (scripts/build-viewers.mjs) в public/viewers/office.js.
 * iframe без allow-same-origin: библиотеки пишут разметку из файла через innerHTML,
 * поэтому чужой документ не должен дотянуться до приложения и папки с конспектами.
 */
import { renderAsync } from 'docx-preview'
import JSZip from 'jszip'
import { init } from 'pptx-preview'

type Kind = 'docx' | 'pptx'
type Incoming = { type: 'render'; kind: Kind; data: ArrayBuffer }

const root = document.getElementById('root') as HTMLElement
const post = (msg: { type: 'boot' } | { type: 'ready'; pages: number } | { type: 'error'; message: string }) => parent.postMessage(msg, '*')

let current: { kind: Kind; data: ArrayBuffer } | null = null
let width = 0

/**
 * pptx-preview читает части по [Content_Types].xml и молча показывает пустоту, если там упомянута несуществующая
 * (так пишут pptxgenjs и некоторые конвертеры; PowerPoint это прощает). Убираем такие записи.
 */
async function tidyPptx(data: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(data)
  const types = zip.file('[Content_Types].xml')
  if (!types) return data
  const xml = await types.async('text')
  const tidy = xml.replace(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g, (m, part: string) => (zip.file(decodeURI(part)) ? m : ''))
  if (tidy === xml) return data
  zip.file('[Content_Types].xml', tidy)
  return zip.generateAsync({ type: 'arraybuffer' })
}

/** Страницы Word шире узкого окна — уменьшаем целиком, а не прокручиваем вбок. */
function fitDocx() {
  const page = root.querySelector<HTMLElement>('section.docx')
  root.style.zoom = page ? String(Math.min(1, (document.documentElement.clientWidth - 24) / (page.offsetWidth + 32))) : ''
}

async function render() {
  if (!current) return
  root.replaceChildren()
  root.style.zoom = ''
  width = root.clientWidth
  try {
    if (current.kind === 'docx') {
      await renderAsync(current.data, root, undefined, {
        className: 'docx',
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        experimental: true,
        renderAltChunks: false,
        renderComments: false,
        useBase64URL: false,
      })
      fitDocx()
      post({ type: 'ready', pages: root.querySelectorAll('section.docx').length })
    } else {
      const w = Math.min(Math.max(width - 32, 320), 1600)
      const previewer = init(root, { width: w, mode: 'list' })
      const pptx = (await previewer.preview(await tidyPptx(current.data.slice(0)))) as { slides?: unknown[] }
      if (!pptx.slides?.length) throw new Error('В презентации не нашлось слайдов, которые получается показать.')
      post({ type: 'ready', pages: pptx.slides.length })
    }
    // ссылки из документа здесь всё равно не откроются (нет allow-popups) — не притворяемся кликабельными
    for (const a of root.querySelectorAll('a[href]')) a.removeAttribute('href')
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

addEventListener('message', (e: MessageEvent<Incoming>) => {
  if (e.source !== parent || e.data?.type !== 'render') return
  current = { kind: e.data.kind, data: e.data.data }
  void render()
})

// слайды рисуются под ширину окна — после изменения размера перерисовываем
let timer = 0
new ResizeObserver(() => {
  if (current?.kind === 'docx') return fitDocx()
  if (current?.kind !== 'pptx' || Math.abs(root.clientWidth - width) < 24) return
  clearTimeout(timer)
  timer = window.setTimeout(render, 200)
}).observe(document.documentElement)

post({ type: 'boot' })
