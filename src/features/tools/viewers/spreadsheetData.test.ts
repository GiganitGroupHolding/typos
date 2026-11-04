import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { utils, write, type BookType, type WorkBook } from "xlsx"
import { fileKind } from "@/vault/format"
import { SpreadsheetBook } from "./spreadsheetData"
import { columnLabel, MAX_SHEET_ROWS, MAX_WINDOW_COLS, MAX_WINDOW_ROWS, viewportWindow } from "./spreadsheetProtocol"

function data(book: WorkBook, bookType: BookType = "xlsx"): ArrayBuffer {
  return write(book, { type: "array", bookType }) as ArrayBuffer
}

function sample() {
  const book = utils.book_new()
  const first = utils.aoa_to_sheet([
    ["Значение", "Дата", "Формула"],
    [12.5, 45292, 7],
  ])
  first.A2.z = "0.00"
  first.B2.z = "dd/mm/yyyy"
  first.C2.f = "3+4"
  utils.book_append_sheet(book, first, "Расчёты")
  utils.book_append_sheet(book, utils.aoa_to_sheet([["<script>не выполнять</script>"]]), "Другой лист")
  return book
}

describe("просмотр таблиц", () => {
  it("переносит размеры, шрифт и цвета Excel, увеличивает высоту под весь текст и не пересылает размеры при прокрутке", async () => {
    const source = new ExcelJS.Workbook()
    const sheet = source.addWorksheet("Оформление")
    sheet.getColumn(1).width = 12
    sheet.getColumn(2).width = 40
    sheet.getRow(2).height = 90
    const cell = sheet.getCell("A1")
    cell.value = "Длинный текст в узком столбце ".repeat(350)
    cell.font = { name: "Arial", size: 20, bold: true, italic: true, color: { argb: "FF123456" } }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCC00" } }
    cell.alignment = { horizontal: "center" }
    sheet.getCell("B2").value = "Коротко"
    sheet.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { theme: 4 } }
    const reader = new SpreadsheetBook(await source.xlsx.writeBuffer())
    await reader.loadAppearance()
    const page = reader.window(0, 0, 0, 5, 5)
    expect(page.cells[0][0]).toBe(cell.value)
    expect(page.cells[0][0].length).toBeGreaterThan(8192)
    expect(page.styles?.[0][0]).toMatchObject({
      fontFamily: "Arial",
      fontSize: (20 * 4) / 3,
      fontWeight: "bold",
      fontStyle: "italic",
      color: "#123456",
      backgroundColor: "#ffcc00",
      textAlign: "center",
    })
    expect(page.styles?.[1][1]?.backgroundColor).toBe("#4f81bd")
    expect(page.layout?.colOffsets).toEqual([0, 89, 374])
    expect(page.layout!.rowOffsets[1]).toBeGreaterThan(1000)
    expect(page.layout!.rowOffsets[2] - page.layout!.rowOffsets[1]).toBe(120)
    expect(reader.window(0, 1, 0, 1, 2, false).layout).toBeUndefined()
  })

  it("находит видимое окно с неодинаковой высотой строк и шириной столбцов", () => {
    const layout = {
      rowOffsets: Array.from({ length: 1001 }, (_, i) => i * 200),
      colOffsets: Array.from({ length: 101 }, (_, i) => i * 40),
    }
    const range = viewportWindow(100028, 2056, 600, 800, layout)
    expect(range.row).toBe(488)
    expect(range.col).toBe(46)
    expect(range.rows).toBeLessThan(50)
    expect(range.cols).toBeGreaterThanOrEqual(30)
  })
  it.each(["xlsx", "xls", "xlsm", "xlsb", "csv", "tsv"])("распознаёт .%s как таблицу проекта", (ext) => {
    expect(fileKind(ext.toUpperCase())).toBe("spreadsheet")
  })

  it.each<BookType>(["xlsx", "biff8", "xlsb"])(
    "читает реальные файлы %s, форматирование чисел и сохранённые результаты формул",
    (format) => {
      const book = new SpreadsheetBook(data(sample(), format))
      expect(book.names).toEqual(["Расчёты", "Другой лист"])
      const page = book.window(0, 0, 0, 10, 10)
      expect(page.cells[1]).toEqual(["12.50", "01/01/2024", "7"])
      expect(book.window(1, 0, 0, 10, 10).cells).toEqual([["<script>не выполнять</script>"]])
      expect(book.window(0, 1, 0, 1, 1).cells).toEqual([["12.50"]])
    },
  )

  it("возвращает только ограниченное окно, даже если запрошен весь большой лист", () => {
    const book = utils.book_new()
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet(Array.from({ length: 200 }, (_, r) => Array.from({ length: 60 }, (_, c) => r * 60 + c))),
      "Лист",
    )
    const reader = new SpreadsheetBook(data(book))
    const page = reader.window(0, 20, 10, 100000, 10000)
    expect(page.cells).toHaveLength(MAX_WINDOW_ROWS)
    expect(page.cells[0]).toHaveLength(MAX_WINDOW_COLS)
    expect(page.cells[0][0]).toBe("1210")
    expect(page.info).toMatchObject({ rows: 200, cols: 60, truncated: false })
  })

  it("ограничивает число разобранных строк и явно отмечает неполный лист", () => {
    const book = utils.book_new()
    utils.book_append_sheet(book, { A1: { t: "s", v: "Начало" }, A100001: { t: "s", v: "Конец" }, "!ref": "A1:A100001" }, "Большой лист")
    const reader = new SpreadsheetBook(data(book))
    const page = reader.window(0, 0, 0, 1, 1)
    expect(page.info.truncated).toBe(true)
    expect(page.info.rows).toBeLessThanOrEqual(MAX_SHEET_ROWS)
    expect(page.cells).toEqual([["Начало"]])
  })

  it("читает CSV и корректно обрабатывает пустой лист и неверный номер листа", () => {
    const csv = new TextEncoder().encode('Имя,Значение\n"Тест, с запятой",12').buffer
    expect(new SpreadsheetBook(csv).window(0, 0, 0, 4, 4).cells[1]).toEqual(["Тест, с запятой", "12"])
    const empty = utils.book_new()
    utils.book_append_sheet(empty, utils.aoa_to_sheet([]), "Пустой")
    const reader = new SpreadsheetBook(data(empty))
    expect(reader.window(0, 0, 0, 10, 10).info).toMatchObject({ rows: 0, cols: 0 })
    expect(() => reader.window(3, 0, 0, 1, 1)).toThrow(/Лист не найден/)
  })

  it("ограничивает окно огромного экрана и сохраняет правильные координаты при прокрутке", () => {
    const range = viewportWindow(280000, 144000, 100000, 100000)
    expect(range.row).toBeGreaterThan(9000)
    expect(range.col).toBeGreaterThan(900)
    expect(range.rows).toBe(MAX_WINDOW_ROWS)
    expect(range.cols).toBe(MAX_WINDOW_COLS)
    expect([0, 25, 26, 16383].map(columnLabel)).toEqual(["A", "Z", "AA", "XFD"])
  })
})
