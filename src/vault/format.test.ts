import { describe, expect, it } from "vitest"
import { extractExcerpt, extractTitle, parseFrontmatter, parsePinBody, serializeFrontmatter } from "./format"

describe("frontmatter", () => {
  it("разбирает и собирает обратно, сохраняя чужие ключи", () => {
    const src = "---\nid: abc\ncreated: 2026-10-01T10:00:00.000Z\ntags: [алгебра]\n---\n\n# Матрицы\n\nТекст"
    const { meta, body } = parseFrontmatter(src)
    expect(meta).toEqual({ id: "abc", created: "2026-10-01T10:00:00.000Z", tags: "[алгебра]" })
    expect(body).toBe("# Матрицы\n\nТекст")
    expect(serializeFrontmatter(meta, body)).toBe(src)
  })

  it("файл без frontmatter (например, созданный в Obsidian)", () => {
    expect(parseFrontmatter("# Просто текст")).toEqual({ meta: {}, body: "# Просто текст" })
  })

  it("CRLF и BOM от Windows-редакторов", () => {
    const { meta, body } = parseFrontmatter("﻿---\r\nid: x\r\n---\r\n\r\n# Т\r\n")
    expect(meta.id).toBe("x")
    expect(body).toBe("# Т\n")
  })
})

describe("заголовок и превью", () => {
  const body = "# Определители\n\nМатрица обратима, если $\\det A \\neq 0$.\n\n$$\n\\det A = ad - bc\n$$\n\n- **Свойство** раз"

  it("заголовок — первая строка без разметки", () => {
    expect(extractTitle(body)).toBe("Определители")
    expect(extractTitle("")).toBe("")
    expect(extractTitle("\n\nпросто **строка**")).toBe("просто строка")
  })

  it("картинка в начале не становится заголовком", () => {
    const b = "![](assets/x.webp)\n\n# Сортировки\n\nТекст"
    expect(extractTitle(b)).toBe("Сортировки")
    expect(extractExcerpt(b)).toBe("Текст")
  })

  it("превью без блоков формул и разметки", () => {
    expect(extractExcerpt(body)).toBe("Матрица обратима, если det A ≠ 0. Свойство раз")
  })

  it("таблица в превью — ячейки через «·», без разделителя", () => {
    const b = "# Т\n\n| Величина | Формула |\n| --- | :-: |\n| Выручка | $TR$ |"
    expect(extractExcerpt(b)).toBe("Величина · Формула Выручка · TR")
  })

  it("цвета, маркер и подчёркивание не попадают в превью и заголовок", () => {
    const b = '# <span data-text-color="red">Важно</span>\n\n<mark data-color="green">Ответ</mark>, ==маркер== и ++подчёркнутое++'
    expect(extractTitle(b)).toBe("Важно")
    expect(extractExcerpt(b)).toBe("Ответ, маркер и подчёркнутое")
  })

  it("LaTeX в превью — символами", () => {
    expect(extractExcerpt("# Т\n\nРазмер $m \\times n$, $A = (a_{ij})$, $\\frac{1}{\\det A}$, $\\lambda \\le 2$")).toBe(
      "Размер m × n, A = (aij), 1/det A, λ ≤ 2",
    )
  })
})

describe("закреп", () => {
  it("достаёт заголовок, формулу и пояснение", () => {
    const pin = parsePinBody("# Обратная матрица\n\n$$\nA^{-1} = \\frac{1}{\\det A} adj A\n$$\n\nСуществует при det A ≠ 0\n")
    expect(pin).toEqual({ title: "Обратная матрица", tex: "A^{-1} = \\frac{1}{\\det A} adj A", text: "Существует при det A ≠ 0" })
  })
})

describe("пустые строки редактора", () => {
  it("&nbsp; в начале не становится заголовком", () => {
    expect(extractTitle("&nbsp;\n\n&nbsp;\n\n# Постановка целей\n\nТекст")).toBe("Постановка целей")
  })
})
