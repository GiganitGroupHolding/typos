import ExcelJS, { type Cell, type Worksheet } from "exceljs"
import JSZip from "jszip"
import type { CellAppearance } from "./spreadsheetProtocol"

const defaultTheme = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"]
const indexedColors = (
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
  "800000 008000 000080 808000 800080 008080 C0C0C0 808080 " +
  "9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCCC " +
  "000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF " +
  "00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 " +
  "3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 " +
  "003366 339966 003300 333300 993300 993366 333399 333333"
).split(" ")
type ExcelColor = { argb?: string; theme?: number; indexed?: number; tint?: number }

export class SpreadsheetAppearance {
  private constructor(privateBook: ExcelJS.Workbook, theme: string[]) {
    this.book = privateBook
    this.theme = theme
  }
  private readonly book: ExcelJS.Workbook
  private readonly theme: string[]

  static async read(data: ArrayBuffer): Promise<SpreadsheetAppearance | null> {
    const signature = new Uint8Array(data, 0, Math.min(2, data.byteLength))
    if (signature[0] !== 80 || signature[1] !== 75) return null
    const zip = await JSZip.loadAsync(data)
    if (!zip.file("xl/workbook.xml")) return null
    const themeXml = await zip.file("xl/theme/theme1.xml")?.async("string")
    const theme = [...defaultTheme]
    const names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
    for (const [i, name] of names.entries()) {
      const block = themeXml?.match(new RegExp(`<a:${name}\\b[^>]*>([\\s\\S]*?)</a:${name}>`))?.[1]
      const rgb = block?.match(/(?:lastClr|val)="([0-9a-fA-F]{6})"/)?.[1]
      if (rgb) theme[i] = rgb
    }
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(data)
    return new SpreadsheetAppearance(book, theme)
  }

  sheet(name: string): Worksheet | undefined {
    return this.book.getWorksheet(name)
  }

  private color(value?: ExcelColor): string | undefined {
    if (!value) return undefined
    const rgb = value.argb?.slice(-6) ?? (value.theme !== undefined ? this.theme[value.theme] : indexedColors[value.indexed ?? -1])
    if (!rgb || !/^[0-9a-f]{6}$/i.test(rgb)) return undefined
    const tint = Math.max(-1, Math.min(1, value.tint ?? 0))
    return (
      "#" +
      [0, 2, 4]
        .map((offset) => {
          const channel = parseInt(rgb.slice(offset, offset + 2), 16)
          return Math.round(tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint)
            .toString(16)
            .padStart(2, "0")
        })
        .join("")
    )
  }

  cell(cell?: Cell): CellAppearance | null {
    if (!cell) return null
    const { font, fill, alignment } = cell
    const decoration = [font?.underline && font.underline !== "none" ? "underline" : "", font?.strike ? "line-through" : ""]
      .filter(Boolean)
      .join(" ")
    const horizontal = alignment?.horizontal
    const appearance: CellAppearance = {
      fontFamily: font?.name,
      fontSize: font?.size ? (font.size * 4) / 3 : undefined,
      fontWeight: font?.bold ? "bold" : undefined,
      fontStyle: font?.italic ? "italic" : undefined,
      textDecoration: decoration || undefined,
      color: this.color(font?.color),
      backgroundColor: fill?.type === "pattern" && fill.pattern !== "none" ? this.color(fill.fgColor ?? fill.bgColor) : undefined,
      textAlign:
        horizontal === "left" || horizontal === "center" || horizontal === "right" || horizontal === "justify" ? horizontal : undefined,
    }
    return Object.fromEntries(Object.entries(appearance).filter(([, value]) => value !== undefined))
  }
}

const context = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : null

/** Высота с переносами рассчитывается один раз в рабочем потоке, а не при прокрутке. */
export function fittedHeight(text: string, width: number, style: CellAppearance | null): number {
  const size = style?.fontSize ?? 14.6667
  if (context)
    context.font = `${style?.fontStyle ?? "normal"} ${style?.fontWeight ?? "normal"} ${size}px ${JSON.stringify(style?.fontFamily ?? "Calibri")}`
  const available = Math.max(1, width - 18)
  let lines = 0
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let used = 0
    lines++
    for (const word of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      const measured = context?.measureText(word).width ?? Array.from(word).length * size * 0.65
      if (used && used + measured > available) {
        lines++
        used = 0
      }
      if (measured > available) {
        for (const char of word) {
          const charWidth = context?.measureText(char).width ?? size * 0.65
          if (used && used + charWidth > available) {
            lines++
            used = 0
          }
          used += charWidth
        }
      } else used += measured
    }
  }
  return Math.ceil(lines * size * 1.45 + 12)
}
