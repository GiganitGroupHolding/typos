import { describe, expect, it } from "vitest"
import { fitFrame, frameRadius } from "./frameGeometry"
import type { BoardFrameShape } from "./model"

describe("смена формы рамки", () => {
  const frame = { x: 100, y: 200, width: 600, height: 140 }
  const content = { x: 110, y: 210, width: 580, height: 120 }

  it.each<BoardFrameShape>(["circle", "hexagon"])("вмещает углы всех карточек после перехода в %s", (shape) => {
    const fitted = fitFrame(frame, shape, content)
    const cx = fitted.x + fitted.width / 2
    const cy = fitted.y + fitted.height / 2
    expect(cx).toBe(frame.x + frame.width / 2)
    expect(cy).toBe(frame.y + frame.height / 2)
    for (const x of [content.x - cx, content.x + content.width - cx]) {
      for (const y of [content.y - cy, content.y + content.height - cy]) {
        const distance = Math.hypot(x, y)
        expect(frameRadius(shape, fitted.width, fitted.height, x / distance, y / distance)).toBeGreaterThan(distance)
      }
    }
  })

  it("сохраняет размер, если карточка уже помещается", () => {
    expect(fitFrame(frame, "circle", { x: 380, y: 250, width: 40, height: 40 })).toEqual(frame)
  })
})
