import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { useDesktopZoom } from "./desktopZoom"
import { useUi } from "./store"

const mocks = vi.hoisted(() => ({ native: vi.fn(), desktop: vi.fn(() => true), error: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.desktop }))
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: mocks.native }) }))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)

function Zoom() {
  useDesktopZoom()
  return null
}

afterEach(() => {
  vi.clearAllMocks()
  mocks.desktop.mockReturnValue(true)
  useUi.setState({ desktopZoom: 100 })
})

it("восстанавливает масштаб окна и возвращает последнее применённое значение при ошибке", async () => {
  mocks.native.mockResolvedValue(undefined)
  useUi.getState().setDesktopZoom(140)
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(createElement(Zoom)))
    expect(mocks.native).toHaveBeenLastCalledWith(1.4)
    mocks.native.mockRejectedValueOnce(new Error("Отказ"))
    await act(async () => useUi.getState().setDesktopZoom(150))
    expect(useUi.getState().desktopZoom).toBe(140)
    expect(mocks.error).toHaveBeenCalledOnce()
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Numpad0", ctrlKey: true, cancelable: true })))
    expect(mocks.native).toHaveBeenLastCalledWith(1)
  } finally {
    await act(async () => root.unmount())
  }
})

it("быстрые изменения применяются по очереди и заканчиваются последним выбранным масштабом", async () => {
  let finish: (() => void) | undefined
  mocks.native
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(undefined)
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(createElement(Zoom)))
    await act(async () => {
      useUi.getState().setDesktopZoom(120)
      useUi.getState().setDesktopZoom(170)
    })
    expect(mocks.native).toHaveBeenCalledTimes(1)
    await act(async () => finish?.())
    expect(mocks.native).toHaveBeenLastCalledWith(1.7)
  } finally {
    await act(async () => root.unmount())
  }
})

it("в браузере не вызывает нативный API и не перехватывает масштабирование", async () => {
  mocks.desktop.mockReturnValue(false)
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(createElement(Zoom)))
    const event = new KeyboardEvent("keydown", { code: "Equal", ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(mocks.native).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})
