import { Loader2, Minus, Plus } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import {
  COL_WIDTH,
  columnLabel,
  fitSheetZoom,
  MAX_FILE_BYTES,
  MAX_WINDOW_COLS,
  MAX_WINDOW_ROWS,
  ROW_HEADER_WIDTH,
  ROW_HEIGHT,
  viewportWindow,
  type SheetWindow,
  type SpreadsheetReply,
  type SpreadsheetRequest,
} from "./viewers/spreadsheetProtocol"

export default function SpreadsheetView({ blob, title }: { blob: Blob; title: string }) {
  const sheetSelectId = useId()
  const host = useRef<HTMLDivElement>(null)
  const worker = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const previewId = useRef(0)
  const previewCanvas = useRef<HTMLCanvasElement>(null)
  const scrollFrame = useRef(0)
  const pendingTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined)
  const [names, setNames] = useState<string[]>([])
  const [sheet, setSheet] = useState(0)
  const [zoomChoice, setZoomChoice] = useState<number | "fit">(1)
  const [window, setWindow] = useState<SheetWindow | null>(null)
  const [error, setError] = useState("")
  const [viewport, setViewport] = useState({ width: 800, height: 500 })
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const layout = window?.sheet === sheet ? window.layout : undefined
  const needsLayout = !layout
  const page = window?.sheet === sheet ? window : null
  const rows = page?.info.rows ?? 0
  const cols = page?.info.cols ?? 0
  const sheetWidth = ROW_HEADER_WIDTH + (layout?.colOffsets[cols] ?? cols * COL_WIDTH)
  const sheetHeight = ROW_HEIGHT + (layout?.rowOffsets[rows] ?? rows * ROW_HEIGHT)
  const fitZoom = fitSheetZoom(sheetWidth, sheetHeight, viewport.width, viewport.height)
  const zoom = zoomChoice === "fit" ? fitZoom : zoomChoice
  const {
    row,
    col,
    rows: windowRows,
    cols: windowCols,
  } = viewportWindow(scroll.top / zoom, scroll.left / zoom, viewport.height / zoom, viewport.width / zoom, layout)
  const previewMode = !!layout && (windowRows >= MAX_WINDOW_ROWS || windowCols >= MAX_WINDOW_COLS)
  const previewWidth = Math.max(1, Math.min(viewport.width, sheetWidth * zoom))
  const previewHeight = Math.max(1, Math.min(viewport.height, sheetHeight * zoom))
  const changeZoom = (value: number | "fit") => {
    cancelAnimationFrame(scrollFrame.current)
    setZoomChoice(value === "fit" ? value : Math.max(Math.min(0.1, fitZoom), Math.min(4, value)))
    setScroll({ top: 0, left: 0 })
    host.current?.scrollTo({ top: 0, left: 0 })
  }
  const rowTop = (index: number) => layout?.rowOffsets[index] ?? index * ROW_HEIGHT
  const colLeft = (index: number) => layout?.colOffsets[index] ?? index * COL_WIDTH

  useEffect(() => {
    let alive = true
    let current: Worker | null = null
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    void (async () => {
      if (blob.size > MAX_FILE_BYTES) throw new Error("Файл больше 40 МБ. Открой его в Excel или сохрани нужный лист отдельным файлом.")
      current = new Worker(new URL("./viewers/spreadsheet.worker.ts", import.meta.url), { type: "module" })
      worker.current = current
      current.onmessage = (event: MessageEvent<SpreadsheetReply>) => {
        if (!alive) return
        const reply = event.data
        if (reply.type === "opened") {
          clearTimeout(timer)
          setNames(reply.names)
        } else if (reply.type === "window" && reply.id === requestId.current) {
          clearTimeout(pendingTimer.current)
          setWindow((previous) => ({
            ...reply.window,
            layout: reply.window.layout ?? (previous?.sheet === reply.window.sheet ? previous.layout : undefined),
          }))
        } else if (reply.type === "preview") {
          if (reply.id === previewId.current) {
            const canvas = previewCanvas.current
            if (canvas) {
              canvas.width = reply.image.width
              canvas.height = reply.image.height
              canvas.getContext("2d")?.drawImage(reply.image, 0, 0)
            }
          }
          reply.image.close()
        } else if (reply.type === "error") {
          clearTimeout(timer)
          clearTimeout(pendingTimer.current)
          current?.terminate()
          setError(reply.message)
        }
      }
      current.onerror = () => alive && setError("Не удалось запустить просмотр таблицы. Скачай файл и открой его в Excel.")
      timer = globalThis.setTimeout(() => {
        current?.terminate()
        if (alive) setError("Таблица открывается слишком долго. Сохрани нужный лист отдельным файлом и попробуй снова.")
      }, 30_000)
      const data = await blob.arrayBuffer()
      if (alive) current.postMessage({ type: "open", data } satisfies SpreadsheetRequest, [data])
    })().catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Не удалось прочитать файл."))
    return () => {
      alive = false
      clearTimeout(timer)
      clearTimeout(pendingTimer.current)
      current?.terminate()
      worker.current = null
      cancelAnimationFrame(scrollFrame.current)
    }
  }, [blob])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!names.length || error || previewMode) return
    const id = ++requestId.current
    worker.current?.postMessage({
      type: "window",
      id,
      sheet,
      row,
      col,
      rows: windowRows,
      cols: windowCols,
      layout: needsLayout,
    } satisfies SpreadsheetRequest)
    pendingTimer.current = globalThis.setTimeout(() => {
      worker.current?.terminate()
      setError("Лист открывается слишком долго. Сохрани его отдельным файлом и попробуй снова.")
    }, 30_000)
    return () => clearTimeout(pendingTimer.current)
  }, [names, sheet, row, col, windowRows, windowCols, error, needsLayout, previewMode])

  useEffect(() => {
    const id = ++previewId.current
    if (!previewMode || error) return
    worker.current?.postMessage({
      type: "preview",
      id,
      sheet,
      zoom,
      top: scroll.top,
      left: scroll.left,
      width: previewWidth,
      height: previewHeight,
    } satisfies SpreadsheetRequest)
  }, [previewMode, error, sheet, zoom, scroll.top, scroll.left, previewWidth, previewHeight])

  const busy = !page || page.row !== row || page.col !== col
  const visibleCols = page?.cells[0]?.length ?? 0

  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-[13px]">
        <label className="shrink-0" htmlFor={sheetSelectId}>
          Лист
        </label>
        <select
          id={sheetSelectId}
          aria-label="Лист таблицы"
          value={sheet}
          disabled={!names.length || !!error}
          onChange={(e) => {
            setSheet(Number(e.target.value))
            setScroll({ top: 0, left: 0 })
            host.current?.scrollTo({ top: 0, left: 0 })
          }}
          className="min-w-0 max-w-xs rounded-md border bg-background px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {names.map((name, index) => (
            <option key={index} value={index}>
              {name}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Масштаб таблицы" className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Уменьшить таблицу"
            disabled={!layout || zoom <= Math.min(0.1, fitZoom)}
            onClick={() => changeZoom(zoom / 1.25)}
            className="rounded border p-1 disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Масштаб таблицы 100%"
            title="Вернуть 100%"
            onClick={() => changeZoom(1)}
            className="min-w-14 rounded px-1 py-1 tabular-nums"
          >
            {new Intl.NumberFormat("ru", { maximumFractionDigits: zoom < 0.001 ? 6 : 1 }).format(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Увеличить таблицу"
            disabled={!layout || zoom >= 4}
            onClick={() => changeZoom(zoom * 1.25)}
            className="rounded border p-1 disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            disabled={!layout || !rows || !cols}
            aria-pressed={zoomChoice === "fit"}
            onClick={() => changeZoom("fit")}
            className="ml-1 rounded border px-2 py-1 disabled:opacity-40"
          >
            Вместить целиком
          </button>
        </div>
        {busy && !previewMode && !error && (
          <Loader2 aria-label="Загрузка листа" className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="ml-auto truncate text-muted-foreground">
          {page ? `${rows.toLocaleString("ru")} строк · ${cols.toLocaleString("ru")} столбцов` : "Открываю…"}
        </span>
      </div>
      <div
        ref={host}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
        onScroll={(e) => {
          const element = e.currentTarget
          cancelAnimationFrame(scrollFrame.current)
          scrollFrame.current = requestAnimationFrame(() => {
            const next = viewportWindow(
              element.scrollTop / zoom,
              element.scrollLeft / zoom,
              element.clientHeight / zoom,
              element.clientWidth / zoom,
              layout,
            )
            setScroll((cur) => {
              const prev = viewportWindow(cur.top / zoom, cur.left / zoom, element.clientHeight / zoom, element.clientWidth / zoom, layout)
              return !previewMode && next.row === prev.row && next.col === prev.col
                ? cur
                : { top: element.scrollTop, left: element.scrollLeft }
            })
          })
        }}
      >
        {error ? (
          <p role="alert" className="p-6 text-center text-[13px] text-muted-foreground">
            {error}
          </p>
        ) : page && rows === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">Пустой лист</p>
        ) : previewMode ? (
          <div className="relative bg-white" style={{ width: sheetWidth * zoom, height: sheetHeight * zoom }}>
            <canvas
              ref={previewCanvas}
              role="img"
              aria-label={`${title} — обзор таблицы`}
              className="sticky top-0 left-0 block"
              style={{ width: previewWidth, height: previewHeight }}
            />
          </div>
        ) : (
          <div
            role="grid"
            aria-label={title}
            aria-readonly="true"
            aria-rowcount={rows + 1}
            aria-colcount={cols + 1}
            aria-busy={busy}
            className="relative bg-white text-black"
            style={{ width: sheetWidth, height: sheetHeight, zoom }}
          >
            <div role="row" aria-rowindex={1} className="sticky top-0 z-20 border-b bg-muted" style={{ height: ROW_HEIGHT }}>
              {Array.from({ length: visibleCols }, (_, i) => (
                <div
                  key={i}
                  role="columnheader"
                  aria-colindex={(page?.col ?? 0) + i + 2}
                  className="absolute top-0 flex h-full items-center justify-center border-r font-medium text-muted-foreground"
                  style={{
                    left: ROW_HEADER_WIDTH + colLeft((page?.col ?? 0) + i),
                    width: colLeft((page?.col ?? 0) + i + 1) - colLeft((page?.col ?? 0) + i),
                  }}
                >
                  {columnLabel((page?.col ?? 0) + i)}
                </div>
              ))}
              <div className="sticky left-0 z-30 h-full border-r bg-muted" style={{ width: ROW_HEADER_WIDTH }} />
            </div>
            {page?.cells.map((cells, index) => (
              <div
                key={page.row + index}
                role="row"
                aria-rowindex={page.row + index + 2}
                className="absolute left-0 w-full"
                style={{ top: ROW_HEIGHT + rowTop(page.row + index), height: rowTop(page.row + index + 1) - rowTop(page.row + index) }}
              >
                <div
                  role="rowheader"
                  className="sticky left-0 z-10 flex h-full items-center justify-end border-r border-b bg-muted px-2 text-[12px] text-muted-foreground"
                  style={{ width: ROW_HEADER_WIDTH }}
                >
                  {page.row + index + 1}
                </div>
                {cells.map((text, i) => (
                  <div
                    key={page.col + i}
                    role="gridcell"
                    aria-colindex={page.col + i + 2}
                    title={text}
                    className="absolute top-0 h-full border-r border-b border-slate-200 px-2 py-1.5 whitespace-pre-wrap [overflow-wrap:anywhere] select-text"
                    style={{
                      fontFamily: "Calibri, Arial, sans-serif",
                      fontSize: 14.6667,
                      lineHeight: 1.45,
                      backgroundColor: "#ffffff",
                      ...page.styles?.[index]?.[i],
                      left: ROW_HEADER_WIDTH + colLeft(page.col + i),
                      width: colLeft(page.col + i + 1) - colLeft(page.col + i),
                    }}
                  >
                    {text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {page?.info.truncated && (
        <p className="shrink-0 border-t px-3 py-2 text-[12px] text-muted-foreground">
          Показаны первые 100 000 строк листа. Полный файл доступен для скачивания.
        </p>
      )}
    </div>
  )
}
