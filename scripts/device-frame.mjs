import { mkdirSync, writeFileSync } from "node:fs"
import sharp from "sharp"

const [input, ...rest] = process.argv.slice(2)
if (!input) {
  console.error("Укажи файл рамки: node scripts/device-frame.mjs <файл.png>")
  process.exit(1)
}
const name = rest.includes("--name") ? rest[rest.indexOf("--name") + 1] : "phone"

const meta = await sharp(input).metadata()
const up = Math.max(1, Math.ceil(2400 / (meta.height ?? 2400)))
const { data, info } = await sharp(input)
  .resize({ height: (meta.height ?? 0) * up, kernel: "lanczos3" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const { width: W, height: H } = info

if (!meta.hasAlpha) {
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (chroma < 14) data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (232 - lum) / 36)))
  }
}
const at = (x, y) => (y * W + x) * 4
const cx = W >> 1
const cy = H >> 1
const seed = at(cx, cy)
const transparent = data[seed + 3] < 16
const [r0, g0, b0] = [data[seed], data[seed + 1], data[seed + 2]]

const isScreen = (i) =>
  transparent
    ? data[i + 3] < 128
    : data[i + 3] > 200 && Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) < 36

const mask = new Uint8Array(W * H)
const stack = [cy * W + cx]
mask[cy * W + cx] = 1
let minX = cx,
  maxX = cx,
  minY = cy,
  maxY = cy
while (stack.length) {
  const p = stack.pop()
  const x = p % W
  const y = (p - x) / W
  if (x < minX) minX = x
  if (x > maxX) maxX = x
  if (y < minY) minY = y
  if (y > maxY) maxY = y
  for (const q of [p - 1, p + 1, p - W, p + W]) {
    if (q < 0 || q >= W * H || mask[q]) continue
    const qx = q % W
    if (Math.abs(qx - x) > 1) continue
    if (isScreen(q * 4)) {
      mask[q] = 1
      stack.push(q)
    }
  }
}
const sw = maxX - minX + 1
const sh = maxY - minY + 1
if (sw < W * 0.5 || sh < H * 0.5 || minX === 0 || minY === 0) {
  console.error(`Не удалось найти экран (${sw}×${sh} из ${W}×${H}). Используй рамку с прозрачным или однотонным экраном.`)
  process.exit(1)
}

let d = 0
while (d < sw / 2 && !mask[(minY + d) * W + minX + d]) d++
const radius = Math.round(d / (1 - Math.SQRT1_2))

if (!transparent) {
  for (let p = 0; p < W * H; p++) if (mask[p]) data[p * 4 + 3] = 0
}
mkdirSync("public/devices", { recursive: true })
const out = `public/devices/${name}.webp`
await sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 92, alphaQuality: 100, effort: 6 })
  .toFile(out)

const frame = { src: `/devices/${name}.webp`, width: W, height: H, screen: { x: minX, y: minY, width: sw, height: sh, radius } }
writeFileSync(
  "src/features/tools/deviceFrame.ts",
  `// Создано scripts/device-frame.mjs — координаты экрана в пикселях картинки рамки.\nimport type { DeviceFrame } from './PhonePreview'\n\nexport const deviceFrame: DeviceFrame | null = ${JSON.stringify(frame, null, 2)}\n`,
)
console.log(`${out}: ${W}×${H}, экран ${sw}×${sh} с (${minX}, ${minY}), радиус ${radius}`)
