import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/Tooltip"
import type { Board } from "@/types"
import { useVault } from "@/vault/store"
import { BoardCanvas } from "./BoardCanvas"
import { frameRadius } from "./frameGeometry"
import type { BoardFrameShape, BoardNode } from "./model"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  vi.spyOn(useVault.getState(), "adoptBoard").mockImplementation(() => {})
  vi.spyOn(useVault.getState(), "saveBoard").mockResolvedValue(null)
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800)
  vi.stubGlobal("PointerEvent", MouseEvent)
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, "elementFromPoint")
})

async function openBoard(shape?: BoardFrameShape) {
  const frame: BoardNode = { id: "frame", type: "group", x: 100, y: 200, width: 600, height: 140, shape, label: "Раздел" }
  const card: BoardNode = { id: "card", type: "text", x: 110, y: 210, width: 580, height: 120, text: "Содержимое" }
  const board: Board = { id: "board", subjectId: "subject", path: "board.md", name: "Доска", data: { nodes: [frame, card], edges: [] } }
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(BoardCanvas, { board }))))
  return { frame, card }
}

async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  await act(async () => button!.click())
}

it("помещает маленький заголовок над окружностью даже у вытянутой рамки", async () => {
  const { frame } = await openBoard("circle")
  const label = host.querySelector('[data-node-id="frame"]')!.querySelector<HTMLElement>(".text-center")!
  expect(Number.parseFloat(label.style.bottom)).toBe((frame.height + Math.min(frame.width, frame.height)) / 2)
  expect(label.classList.contains("-translate-x-1/2")).toBe(true)
  expect(label.textContent).toBe("Раздел")
  expect(label.firstElementChild!.getAttribute("style")).toContain("12px")
})

it.each<BoardFrameShape | undefined>([undefined, "rectangle", "circle", "hexagon"])(
  "при отдалении накрывает содержимое рамки %s затемнением и убирает его при приближении",
  async (shape) => {
    await openBoard(shape)
    const overlays = () => host.querySelectorAll('path[fill="rgb(0 0 0 / 65%)"]')
    expect(overlays()).toHaveLength(0)
    for (let i = 0; i < 6; i++) await click("Мельче")
    expect(overlays()).toHaveLength(1)
    const card = host.querySelector('[data-node-id="card"]')!
    expect(card.compareDocumentPosition(overlays()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(overlays()[0].parentElement!.classList.contains("pointer-events-none")).toBe(true)
    for (let i = 0; i < 6; i++) await click("Крупнее")
    expect(overlays()).toHaveLength(0)
  },
)

it("сохраняет размеры новой формы со всем содержимым и отменяет смену формы целиком", async () => {
  const { frame, card } = await openBoard()
  const canvas = host.firstElementChild as HTMLElement
  canvas.setPointerCapture = vi.fn()
  await act(async () => {
    host.querySelector('[data-node-id="frame"] path')!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  })
  await act(async () => canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 })))
  await click("Круг")
  await act(async () => vi.advanceTimersByTimeAsync(600))
  const saved = vi.mocked(useVault.getState().saveBoard).mock.calls.at(-1)![1]
  const fitted = saved.nodes.find((n) => n.id === frame.id)!
  expect(fitted.shape).toBe("circle")
  expect(saved.nodes.find((n) => n.id === card.id)).toEqual(card)
  for (const x of [card.x, card.x + card.width]) {
    for (const y of [card.y, card.y + card.height]) {
      const dx = x - fitted.x - fitted.width / 2
      const dy = y - fitted.y - fitted.height / 2
      const distance = Math.hypot(dx, dy)
      expect(frameRadius(fitted.shape, fitted.width, fitted.height, dx / distance, dy / distance)).toBeGreaterThan(distance)
    }
  }
  await click("Отменить")
  await act(async () => vi.advanceTimersByTimeAsync(600))
  expect(vi.mocked(useVault.getState().saveBoard).mock.calls.at(-1)![1].nodes).toEqual([frame, card])
})
