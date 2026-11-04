import { afterEach, expect, it, vi } from "vitest"
import type { WorkSheet } from "xlsx"
import { paintSpreadsheet } from "./spreadsheetPreview"
import { fitSheetZoom, type CellAppearance } from "./spreadsheetProtocol"

afterEach(() => vi.unstubAllGlobals())

it("рисует цветную ячейку в конце большого листа и ограничивает размер изображения", () => {
  const fills: { color: string; x: number; y: number }[] = []
  const context = {
    fillStyle: "",
    scale: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect(x: number, y: number) {
      fills.push({ color: context.fillStyle, x, y })
    },
  }
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      readonly width: number
      readonly height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
      getContext() {
        return context
      }
      transferToImageBitmap() {
        return { width: this.width, height: this.height }
      }
    },
  )
  const sheet: WorkSheet = { "!data": [] }
  sheet["!data"]![999] = []
  sheet["!data"]![999][79] = { t: "s", v: "Последняя ячейка" }
  const styles: (CellAppearance | null)[][] = []
  styles[999] = []
  styles[999][79] = { backgroundColor: "#ffcc00" }
  const layout = {
    rowOffsets: Array.from({ length: 1001 }, (_, i) => i * 28),
    colOffsets: Array.from({ length: 81 }, (_, i) => i * 144),
  }
  const zoom = fitSheetZoom(11576, 28028, 800, 500)
  paintSpreadsheet(sheet, styles, layout, zoom, 0, 0, 800, 500)
  expect(fills).toContainEqual({ color: "#ffcc00", x: 56 + 79 * 144, y: 28 + 999 * 28 })
  const image = paintSpreadsheet(sheet, styles, layout, zoom, 0, 0, 8000, 4000)
  expect(image.width * image.height).toBeLessThan(4_010_000)
})
