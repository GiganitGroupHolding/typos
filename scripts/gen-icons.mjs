import { mkdir, rm, writeFile } from "node:fs/promises"
import sharp from "sharp"

const hex = (r, c = 32) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return [c + r * Math.cos(a), c + r * Math.sin(a)]
  })
const pts = (p) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")

const FACE_ALPHA = [0.16, 0.08, 0.05, 0.07, 0.12, 0.22]

function figure({ R, faces, inner, line, width, frost = 1 }) {
  const O = hex(R)
  const I = hex(R * 0.42)
  const f = O.map((p, i) => {
    const j = (i + 1) % 6
    return `<polygon points="${pts([p, O[j], I[j], I[i]])}" fill="${faces}" fill-opacity="${(FACE_ALPHA[i] * frost).toFixed(3)}"/>`
  }).join("")
  const spokes = O.map(
    ([x, y], i) => `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${I[i][0].toFixed(2)}" y2="${I[i][1].toFixed(2)}"/>`,
  ).join("")
  return `${f}<polygon points="${pts(I)}" fill="${inner}"/><g fill="none" stroke="${line}" stroke-width="${width}" stroke-linejoin="round"><polygon points="${pts(O)}"/><polygon points="${pts(I)}"/>${spokes}</g>`
}

const defs = `<defs>
<radialGradient id="warm" cx="0.72" cy="0.24" r="0.5"><stop offset="0" stop-color="#ff8a3d" stop-opacity="0.95"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></radialGradient>
<radialGradient id="cool" cx="0.26" cy="0.68" r="0.55"><stop offset="0" stop-color="#16b3ad" stop-opacity="0.9"/><stop offset="1" stop-color="#16b3ad" stop-opacity="0"/></radialGradient>
<linearGradient id="core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6f9cf2"/><stop offset="1" stop-color="#3d63c8"/></linearGradient>
</defs>`

const glass = (R, width = R / 34) => figure({ R, faces: "#ffffff", inner: "url(#core)", line: "rgba(255,255,255,0.92)", width, frost: 1.8 })
const scene = (rx) =>
  `<rect width="64" height="64" rx="${rx}" fill="#0b0d10"/><rect width="64" height="64" rx="${rx}" fill="url(#cool)"/><rect width="64" height="64" rx="${rx}" fill="url(#warm)"/>`

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}${scene(15)}${glass(22)}</svg>`
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}${scene(15)}${glass(23, 2.4)}</svg>`

const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}${scene(0)}${glass(19)}</svg>`

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="7.5 4.5 49 55"><style>.m{color:#1f1e1d}@media (prefers-color-scheme:dark){.m{color:#f5f4f0}}</style><g class="m">${figure({ R: 26, faces: "currentColor", inner: "currentColor", line: "currentColor", width: 1.5 })}</g></svg>`

await mkdir("public/icons", { recursive: true })
await mkdir("public/brand", { recursive: true })
for (const [file, svg] of [
  ["public/favicon.svg", favicon],
  ["public/brand/typos-icon.svg", icon],
  ["public/brand/typos-mark.svg", mark],
]) {
  await writeFile(file, `${svg}\n`)
  console.log("✓", file)
}
await rm("public/brand/typos-logo.svg", { force: true })
for (const [file, svg, size] of [
  ["public/icons/icon-192.png", icon, 192],
  ["public/icons/icon-512.png", icon, 512],
  ["public/icons/maskable-512.png", fullBleed, 512],
  ["public/icons/apple-touch-icon.png", fullBleed, 180],
]) {
  await writeFile(file, await sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toBuffer())
  console.log("✓", file)
}
