import { describe, expect, it } from "vitest"
import { mergeText } from "./mergeText"

describe("Слияние текста", () => {
  it("сохраняет несколько независимых правок обеих сторон", () => {
    expect(mergeText("а\nб\nв\nг\nд", "А\nб\nВ\nг\nд", "а\nБ\nв\nг\nД")).toBe("А\nБ\nВ\nг\nД")
  })
  it("объединяет добавление и удаление в разных местах", () => {
    expect(mergeText("а\nб\nв\nг", "а\nв\nг", "а\nб\nв\nг\nд")).toBe("а\nв\nг\nд")
  })
  it("не дублирует одинаковые изменения", () => {
    expect(mergeText("а\nб\nв", "А\nб\nв", "А\nб\nВ")).toBe("А\nб\nВ")
  })
  it("отказывается выбирать между разными правками одной строки", () => {
    expect(mergeText("а\nб", "А\nб", "Б\nб")).toBeNull()
    expect(mergeText("а", "а\nб", "а\nв")).toBeNull()
  })
  it("не теряет удаление при пересечении с заменой", () => {
    expect(mergeText("а\nб\nв", "а\nв", "а\nБ\nв")).toBeNull()
  })
  it("сравнивает переводы строк Windows и Unix одинаково", () => {
    expect(mergeText("а\r\nб", "А\nб", "а\nБ")).toBe("А\nБ")
  })
})
