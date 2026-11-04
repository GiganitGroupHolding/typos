import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import SpreadsheetView from "./SpreadsheetView"
import type { SpreadsheetReply, SpreadsheetRequest } from "./viewers/spreadsheetProtocol"

let host: HTMLDivElement
let root: Root
const workers: TestWorker[] = []
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo")

class TestWorker {
  readonly requests: SpreadsheetRequest[] = []
  onmessage: ((event: MessageEvent<SpreadsheetReply>) => void) | null = null
  onerror: (() => void) | null = null
  terminate = vi.fn()
  constructor() {
    workers.push(this)
  }
  postMessage(message: SpreadsheetRequest) {
    this.requests.push(message)
    queueMicrotask(() => {
      if (message.type === "preview") {
        this.onmessage?.({
          data: {
            type: "preview",
            id: message.id,
            image: { width: Math.ceil(message.width), height: Math.ceil(message.height), close: vi.fn() } as unknown as ImageBitmap,
          },
        } as MessageEvent<SpreadsheetReply>)
        return
      }
      const reply: SpreadsheetReply =
        message.type === "open"
          ? { type: "opened", names: ["Лист 1", "Лист 2"] }
          : {
              type: "window",
              id: message.id,
              window: {
                sheet: message.sheet,
                row: message.row,
                col: message.col,
                info: { name: "Лист", rows: 100000, cols: 1000, truncated: false },
                cells: Array.from({ length: message.rows }, () => Array.from({ length: message.cols }, () => "<b>Текст</b>")),
                styles: [[{ fontSize: 24, backgroundColor: "#ffcc00", color: "#123456" }]],
                layout: message.layout
                  ? {
                      rowOffsets: Array.from({ length: 100001 }, (_, i) => i * 80),
                      colOffsets: Array.from({ length: 1001 }, (_, i) => i * 210),
                    }
                  : undefined,
              },
            }
      this.onmessage?.({ data: reply } as MessageEvent<SpreadsheetReply>)
    })
  }
}

beforeEach(() => {
  workers.length = 0
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("Worker", TestWorker)
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
})

it("меняет только масштаб таблицы и сбрасывает его до 100%", async () => {
  await act(async () => root.render(createElement(SpreadsheetView, { blob: new Blob(["test"]), title: "Таблица" })))
  const zoomIn = host.querySelector<HTMLButtonElement>('[aria-label="Увеличить таблицу"]')!
  const reset = host.querySelector<HTMLButtonElement>('[aria-label="Масштаб таблицы 100%"]')!
  await act(async () => zoomIn.click())
  expect((host.querySelector('[role="grid"]') as HTMLElement).style.zoom).toBe("1.25")
  expect(reset.textContent).toBe("125%")
  expect(document.documentElement.style.zoom).toBe("")
  await act(async () => reset.click())
  expect((host.querySelector('[role="grid"]') as HTMLElement).style.zoom).toBe("1")
})

it("вмещает огромный лист целиком и рисует обзор без создания всех ячеек", async () => {
  await act(async () => root.render(createElement(SpreadsheetView, { blob: new Blob(["test"]), title: "Таблица" })))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!.click())
  expect(host.querySelectorAll('[role="gridcell"]')).toHaveLength(0)
  const canvas = host.querySelector("canvas")!
  expect(canvas).not.toBeNull()
  const request = workers[0].requests.filter((message) => message.type === "preview").at(-1)!
  expect(request.zoom).toBeLessThan(0.001)
  expect((8_000_000 + 28) * request.zoom).toBeLessThanOrEqual(500)
  expect((210_000 + 56) * request.zoom).toBeLessThanOrEqual(800)
  expect(request.top).toBe(0)
  expect(request.left).toBe(0)
  expect(Number.parseFloat(canvas.style.height)).toBeLessThanOrEqual(500)
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Масштаб таблицы 100%"]')!.click())
  expect(host.querySelector('[role="gridcell"]')).not.toBeNull()
})

it("показывает ограниченное число ячеек, не исполняет их разметку и не сообщает о таймауте после успешной загрузки", async () => {
  await act(async () => root.render(createElement(SpreadsheetView, { blob: new Blob(["test"]), title: "Таблица" })))
  const cells = host.querySelectorAll('[role="gridcell"]')
  expect(cells.length).toBeGreaterThan(0)
  expect(cells.length).toBeLessThanOrEqual(4800)
  expect(host.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("100001")
  expect(cells[0].textContent).toBe("<b>Текст</b>")
  expect(cells[0].querySelector("b")).toBeNull()
  const first = cells[0] as HTMLElement
  expect(first.style.fontSize).toBe("24px")
  expect(first.style.backgroundColor).toBe("rgb(255, 204, 0)")
  expect(first.style.width).toBe("210px")
  expect((first.parentElement as HTMLElement).style.height).toBe("80px")
  expect(first.className).toContain("whitespace-pre-wrap")
  expect(first.className).not.toContain("truncate")
  await act(async () => vi.advanceTimersByTimeAsync(31000))
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(workers[0].terminate).not.toHaveBeenCalled()
  await act(async () => root.unmount())
  expect(workers[0].terminate).toHaveBeenCalledTimes(1)
  root = createRoot(host)
})
