import { read, utils, type WorkSheet } from "xlsx"
import { fittedHeight, SpreadsheetAppearance } from "./spreadsheetAppearance"
import { paintSpreadsheet } from "./spreadsheetPreview"
import {
  COL_WIDTH,
  MAX_FILE_BYTES,
  MAX_SHEET_ROWS,
  MAX_WINDOW_COLS,
  MAX_WINDOW_ROWS,
  ROW_HEIGHT,
  type CellAppearance,
  type SheetLayout,
  type SheetWindow,
} from "./spreadsheetProtocol"

const count = (value: number, max: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(value) ? value : 0)))

export class SpreadsheetBook {
  readonly names: string[]
  private readonly data: ArrayBuffer
  private active = -1
  private sheet: WorkSheet | null = null
  private appearance: SpreadsheetAppearance | null = null
  private layout: SheetLayout = { rowOffsets: [0], colOffsets: [0] }
  private styles: (CellAppearance | null)[][] = []

  async loadAppearance() {
    this.appearance = await SpreadsheetAppearance.read(this.data)
  }

  preview(index: number, zoom: number, top: number, left: number, width: number, height: number): ImageBitmap {
    this.window(index, 0, 0, 0, 0, false)
    return paintSpreadsheet(this.sheet!, this.styles, this.layout, zoom, top, left, width, height)
  }

  constructor(data: ArrayBuffer) {
    if (data.byteLength > MAX_FILE_BYTES) throw new Error("Файл больше 40 МБ. Открой его в Excel или сохрани нужный лист отдельным файлом.")
    this.data = data
    this.names = read(data, { type: "array", codepage: 65001, bookSheets: true }).SheetNames
    if (!this.names.length) throw new Error("В файле нет листов. Проверь файл в Excel.")
  }

  window(index: number, row: number, col: number, rows: number, cols: number, includeLayout = true): SheetWindow {
    if (!Number.isInteger(index) || index < 0 || index >= this.names.length) throw new Error("Лист не найден. Выбери другой лист.")
    if (this.active !== index) {
      // Текст и расчёт высоты кешируются для открытого листа, чтобы не пересчитывать их при прокрутке.
      this.sheet = null
      this.active = -1
      const book = read(this.data, {
        type: "array",
        codepage: 65001,
        sheets: index,
        dense: true,
        sheetRows: MAX_SHEET_ROWS,
        cellFormula: false,
        cellHTML: false,
        cellText: true,
        cellNF: true,
        cellStyles: true,
        sheetStubs: true,
        bookVBA: false,
      })
      this.sheet = book.Sheets[this.names[index]]
      if (!this.sheet) throw new Error("Не удалось прочитать лист. Проверь файл в Excel.")
      this.active = index
      const source = this.appearance?.sheet(this.names[index])
      const range = this.sheet["!ref"] ? utils.decode_range(this.sheet["!ref"]) : null
      const rowCount = range ? count(range.e.r + 1, MAX_SHEET_ROWS) : 0
      const colCount = range ? count(range.e.c + 1, 16384) : 0
      const colOffsets = [0]
      for (let c = 0; c < colCount; c++) {
        const column = source?.getColumn(c + 1)
        const legacy = this.sheet["!cols"]?.[c]
        const width = column?.width ?? source?.properties.defaultColWidth
        const pixels = width ? Math.floor(width * 7 + 5) : (legacy?.wpx ?? (legacy?.wch ? legacy.wch * 7 + 5 : COL_WIDTH))
        colOffsets.push(colOffsets[c] + Math.max(24, pixels))
      }
      const rowOffsets = [0]
      this.styles = []
      for (let r = 0; r < rowCount; r++) {
        const original = source?.getRow(r + 1)
        const points = original?.height ?? source?.properties.defaultRowHeight ?? this.sheet["!rows"]?.[r]?.hpt
        let height = Math.max(ROW_HEIGHT, points ? (points * 4) / 3 : 0)
        const line = this.sheet["!data"]?.[r]
        const styles: (CellAppearance | null)[] = []
        for (let c = 0; c < Math.min(colCount, line?.length ?? 0); c++) {
          const cell = line?.[c]
          if (!cell) continue
          const style = this.appearance?.cell(original?.getCell(c + 1)) ?? null
          styles[c] = style
          const text = cell.w ?? utils.format_cell(cell)
          if (text) height = Math.max(height, fittedHeight(text, colOffsets[c + 1] - colOffsets[c], style))
        }
        this.styles[r] = styles
        rowOffsets.push(rowOffsets[r] + height)
      }
      this.layout = { rowOffsets, colOffsets }
    }
    const sheet = this.sheet!
    const range = sheet["!ref"] ? utils.decode_range(sheet["!ref"]) : null
    const full = sheet["!fullref"] ? utils.decode_range(String(sheet["!fullref"])) : range
    const totalRows = range ? count(range.e.r + 1, MAX_SHEET_ROWS) : 0
    const totalCols = range ? count(range.e.c + 1, 16384) : 0
    const startRow = count(row, totalRows)
    const startCol = count(col, totalCols)
    const cells: string[][] = []
    const styles: (CellAppearance | null)[][] = []
    for (let r = startRow; r < Math.min(totalRows, startRow + count(rows, MAX_WINDOW_ROWS)); r++) {
      const line: string[] = []
      const appearance: (CellAppearance | null)[] = []
      for (let c = startCol; c < Math.min(totalCols, startCol + count(cols, MAX_WINDOW_COLS)); c++) {
        const cell = sheet["!data"]?.[r]?.[c]
        line.push(cell ? (cell.w ?? utils.format_cell(cell)) : "")
        appearance.push(this.styles[r]?.[c] ?? null)
      }
      cells.push(line)
      styles.push(appearance)
    }
    return {
      sheet: index,
      row: startRow,
      col: startCol,
      info: { name: this.names[index], rows: totalRows, cols: totalCols, truncated: !!full && full.e.r >= MAX_SHEET_ROWS },
      cells,
      styles,
      layout: includeLayout ? this.layout : undefined,
    }
  }
}
