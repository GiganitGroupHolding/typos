import { utils, type WorkSheet } from "xlsx"
import { columnLabel, offsetIndex, ROW_HEADER_WIDTH, ROW_HEIGHT, type CellAppearance, type SheetLayout } from "./spreadsheetProtocol"

/** Обзор рисуется в рабочем потоке, чтобы отдаление не создавало тысячи элементов интерфейса. */
export function paintSpreadsheet(
  sheet: WorkSheet,
  styles: (CellAppearance | null)[][],
  layout: SheetLayout,
  zoom: number,
  top: number,
  left: number,
  width: number,
  height: number,
): ImageBitmap {
  const resolution = Math.min(1, Math.sqrt(4_000_000 / Math.max(1, width * height)))
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width * resolution)), Math.max(1, Math.ceil(height * resolution)))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Не удалось показать обзор таблицы. Увеличь масштаб и попробуй снова.")
  ctx.scale(resolution, resolution)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)
  ctx.scale(zoom, zoom)
  ctx.translate(-left / zoom, -top / zoom)
  const { rowOffsets, colOffsets } = layout
  const first = offsetIndex(rowOffsets, Math.max(0, top / zoom - ROW_HEIGHT))
  const last = Math.min(rowOffsets.length - 2, offsetIndex(rowOffsets, (top + height) / zoom) + 1)
  const startCol = offsetIndex(colOffsets, Math.max(0, left / zoom - ROW_HEADER_WIDTH))
  const endCol = offsetIndex(colOffsets, (left + width) / zoom) + 1
  for (let r = first; r <= last; r++) {
    const line = sheet["!data"]?.[r]
    if (!line) continue
    const y = ROW_HEIGHT + rowOffsets[r]
    const cellHeight = rowOffsets[r + 1] - rowOffsets[r]
    for (const key of Object.keys(line)) {
      const c = Number(key)
      if (c < startCol || c > endCol || c >= colOffsets.length - 1) continue
      const cell = line[c]
      if (!cell) continue
      const style = styles[r]?.[c]
      const x = ROW_HEADER_WIDTH + colOffsets[c]
      const cellWidth = colOffsets[c + 1] - colOffsets[c]
      if (style?.backgroundColor) {
        ctx.fillStyle = style.backgroundColor
        ctx.fillRect(x, y, cellWidth, cellHeight)
      }
      const size = style?.fontSize ?? 14.6667
      if (size * zoom < 3 || cellWidth * zoom < 6) continue
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cellWidth, cellHeight)
      ctx.clip()
      ctx.font = `${style?.fontStyle ?? "normal"} ${style?.fontWeight ?? "normal"} ${size}px ${JSON.stringify(style?.fontFamily ?? "Calibri")}`
      ctx.fillStyle = style?.color ?? "#000000"
      ctx.textBaseline = "top"
      ctx.textAlign = style?.textAlign === "right" ? "right" : style?.textAlign === "center" ? "center" : "left"
      const textX = ctx.textAlign === "right" ? x + cellWidth - 8 : ctx.textAlign === "center" ? x + cellWidth / 2 : x + 8
      let textY = y + 6
      for (const paragraph of (cell.w ?? utils.format_cell(cell)).split(/\r\n|\r|\n/)) {
        let text = ""
        let measured = 0
        for (const char of paragraph) {
          const advance = ctx.measureText(char).width
          if (text && measured + advance > cellWidth - 18) {
            ctx.fillText(text, textX, textY)
            textY += size * 1.45
            text = ""
            measured = 0
          }
          text += char
          measured += advance
        }
        ctx.fillText(text, textX, textY)
        textY += size * 1.45
      }
      ctx.restore()
    }
  }
  ctx.lineWidth = 1 / zoom
  ctx.strokeStyle = "#e2e8f0"
  ctx.beginPath()
  for (let r = first; r <= last; r++) {
    if ((rowOffsets[r + 1] - rowOffsets[r]) * zoom < 6) continue
    const y = ROW_HEIGHT + rowOffsets[r]
    ctx.moveTo(ROW_HEADER_WIDTH, y)
    ctx.lineTo(ROW_HEADER_WIDTH + colOffsets.at(-1)!, y)
  }
  for (let c = startCol; c < Math.min(colOffsets.length - 1, endCol + 1); c++) {
    if ((colOffsets[c + 1] - colOffsets[c]) * zoom < 6) continue
    const x = ROW_HEADER_WIDTH + colOffsets[c]
    ctx.moveTo(x, ROW_HEIGHT)
    ctx.lineTo(x, ROW_HEIGHT + rowOffsets.at(-1)!)
  }
  ctx.stroke()
  ctx.font = "12px Arial"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const headerY = top / zoom
  const headerX = left / zoom
  ctx.fillStyle = "#f1f5f9"
  ctx.fillRect(headerX, headerY, width / zoom, ROW_HEIGHT)
  ctx.fillRect(headerX, headerY, ROW_HEADER_WIDTH, height / zoom)
  ctx.fillStyle = "#475569"
  for (let c = startCol; c < Math.min(colOffsets.length - 1, endCol + 1); c++) {
    if ((colOffsets[c + 1] - colOffsets[c]) * zoom >= 16)
      ctx.fillText(columnLabel(c), ROW_HEADER_WIDTH + (colOffsets[c] + colOffsets[c + 1]) / 2, headerY + ROW_HEIGHT / 2)
  }
  if (ROW_HEADER_WIDTH * zoom >= 16) {
    for (let r = first; r <= last; r++) {
      if ((rowOffsets[r + 1] - rowOffsets[r]) * zoom >= 12)
        ctx.fillText(String(r + 1), headerX + ROW_HEADER_WIDTH / 2, ROW_HEIGHT + (rowOffsets[r] + rowOffsets[r + 1]) / 2)
    }
  }
  return canvas.transferToImageBitmap()
}
