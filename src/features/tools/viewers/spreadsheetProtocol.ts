export const MAX_FILE_BYTES = 40 * 1024 * 1024
export const MAX_SHEET_ROWS = 100_000
export const MAX_WINDOW_ROWS = 120
export const MAX_WINDOW_COLS = 40
export const ROW_HEIGHT = 28
export const COL_WIDTH = 144
export const ROW_HEADER_WIDTH = 56

export interface SheetInfo {
  name: string
  rows: number
  cols: number
  truncated: boolean
}

export interface SheetWindow {
  sheet: number
  row: number
  col: number
  info: SheetInfo
  cells: string[][]
  styles?: (CellAppearance | null)[][]
  layout?: SheetLayout
}

export interface CellAppearance {
  fontFamily?: string
  fontSize?: number
  fontWeight?: "bold"
  fontStyle?: "italic"
  textDecoration?: string
  color?: string
  backgroundColor?: string
  textAlign?: "left" | "center" | "right" | "justify"
}

export interface SheetLayout {
  rowOffsets: number[]
  colOffsets: number[]
}

export type SpreadsheetRequest =
  | { type: "open"; data: ArrayBuffer }
  | { type: "window"; id: number; sheet: number; row: number; col: number; rows: number; cols: number; layout?: boolean }
  | { type: "preview"; id: number; sheet: number; zoom: number; top: number; left: number; width: number; height: number }

export type SpreadsheetReply =
  | { type: "opened"; names: string[] }
  | { type: "window"; id: number; window: SheetWindow }
  | { type: "preview"; id: number; image: ImageBitmap }
  | { type: "error"; message: string }

export function columnLabel(index: number): string {
  let result = ""
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result
  return result
}

export function offsetIndex(offsets: number[], value: number) {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (offsets[mid] <= value) lo = mid
    else hi = mid - 1
  }
  return Math.min(lo, Math.max(0, offsets.length - 2))
}

export function fitSheetZoom(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return Math.min(1, Math.max(1, viewportWidth - 4) / Math.max(1, width), Math.max(1, viewportHeight - 4) / Math.max(1, height))
}

export function viewportWindow(top: number, left: number, height: number, width: number, layout?: SheetLayout) {
  const firstRow = layout ? offsetIndex(layout.rowOffsets, Math.max(0, top - ROW_HEIGHT)) : Math.floor(top / ROW_HEIGHT)
  const firstCol = layout ? offsetIndex(layout.colOffsets, Math.max(0, left - ROW_HEADER_WIDTH)) : Math.floor(left / COL_WIDTH)
  return {
    row: Math.max(0, Math.floor(firstRow / 16) * 16 - 8),
    col: Math.max(0, Math.floor(firstCol / 4) * 4 - 2),
    rows: Math.min(
      MAX_WINDOW_ROWS,
      (layout ? offsetIndex(layout.rowOffsets, top + height) - firstRow : Math.ceil(height / ROW_HEIGHT)) + 40,
    ),
    cols: Math.min(MAX_WINDOW_COLS, (layout ? offsetIndex(layout.colOffsets, left + width) - firstCol : Math.ceil(width / COL_WIDTH)) + 10),
  }
}
