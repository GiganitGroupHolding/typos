// Песочница просмотра DOCX/PPTX — отдельный IIFE-бандл в public/viewers/office.js.
// iframe без same-origin грузит его обычным <script src> (модулям нужен CORS), а приложение его не импортирует.
// Пересобирается, только если поменялся код песочницы или зависимости.
import { existsSync, statSync } from 'node:fs'
import { build } from 'vite'

const entry = 'src/features/tools/viewers/officeFrame.ts'
const out = 'public/viewers/office.js'
const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0)

if (process.argv.includes('--force') || mtime(out) < Math.max(mtime(entry), mtime('package-lock.json'), mtime(import.meta.filename))) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: 'public/viewers',
      emptyOutDir: true,
      reportCompressedSize: false,
      lib: { entry, formats: ['iife'], name: 'TyposOffice', fileName: () => 'office.js' },
    },
  })
  console.log(`viewers: ${out} (${Math.round(statSync(out).size / 1024)} КБ)`)
}
