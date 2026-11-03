import { MarkdownManager } from "@tiptap/markdown"
import { describe, expect, it } from "vitest"
import { buildExtensions } from "./extensions"

const md = new MarkdownManager({ extensions: buildExtensions() })
const roundTrip = (src: string) => md.serialize(md.parse(src))

describe("markdown ↔ tiptap", () => {
  it("сохраняет inline-формулы", () => {
    const src = "Матрица $A = (a_{ij})$ размера $m \\times n$."
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("сохраняет блочные формулы", () => {
    const src = "Текст\n\n$$\nc_{ij} = \\sum_{k=1}^{n} a_{ik} b_{kj}\n$$\n\nПосле"
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("таблицы с формулами и форматированием", () => {
    const src = "До\n\n| Величина | Формула |\n| --- | --- |\n| Выручка | $TR = P \\cdot Q$ |\n| **Цена** | P |\n\nПосле"
    const out = roundTrip(src)
    const doc = md.parse(out)
    expect(doc.content?.[1].type).toBe("table")
    expect(out).toContain("$TR = P \\cdot Q$")
    expect(out).toContain("**Цена**")
    expect(md.serialize(doc)).toBe(out)
  })

  it("матрицы с \\\\ и & внутри формулы", () => {
    const src = "$$\n\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\n$$"
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("заголовки, списки, жирный, код, цитата, кириллица", () => {
    const src = [
      "# Определители",
      "",
      "## Свойства",
      "",
      "- $\\det A^T = \\det A$",
      "- **Важно:** перестановка строк меняет знак",
      "",
      "1. Первый",
      "2. Второй",
      "",
      "> Цитата с `кодом`",
    ].join("\n")
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("чекбоксы", () => {
    const src = "- [ ] выучить\n- [x] повторить"
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("картинки с относительным путём", () => {
    const src = "![доска](assets/board.webp)"
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("подчёркнутый, зачёркнутый, маркер", () => {
    const src = "Текст ++важно++, ~~неверно~~ и ==запомнить==."
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("цвет текста и цветной фон (как в Notion)", () => {
    const src = 'Это <span data-text-color="red">ошибка</span>, а это <mark data-color="green">ответ</mark>.'
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("цвет поверх жирного", () => {
    const src = '<span data-text-color="blue">**жирный** и обычный</span>'
    expect(roundTrip(src).trim()).toBe(src)
  })

  it("формула внутри цвета не теряется (цвет на формулу не ложится)", () => {
    const out = roundTrip('<span data-text-color="blue">текст $x^2$</span>').trim()
    expect(out).toContain("$x^2$")
    expect(out).toContain('<span data-text-color="blue">текст</span>')
    expect(roundTrip(out).trim()).toBe(out)
  })

  it("неизвестный цвет не превращается в разметку", () => {
    const doc = md.parse('<span data-text-color="evil">x</span>')
    expect(JSON.stringify(doc)).not.toContain('"textColor"')
  })

  it("стабильна: второй проход не меняет текст", () => {
    const src = "# Заголовок\n\nТекст $x^2$ и **жирный**.\n\n$$\nE = mc^2\n$$"
    const once = roundTrip(src)
    expect(roundTrip(once)).toBe(once)
  })
})
