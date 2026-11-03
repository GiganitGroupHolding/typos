import { describe, expect, it } from "vitest"
import { sampleVault } from "@/test/sampleVault"
import { loadVault } from "@/vault/repo"
import { buildDocs, createIndex, normalize, plainText, search, snippet } from "./searchIndex"

const index = async () => {
  return createIndex(buildDocs(await loadVault(sampleVault())))
}

describe("поиск", () => {
  it("находит по тексту конспекта, а не только по названию", async () => {
    const ms = await index()
    const hits = search(ms, "коммутативно")
    expect(hits[0]).toMatchObject({ kind: "note", title: "Матрицы и операции над ними" })
  })

  it("формы слова: префикс и опечатки", async () => {
    const ms = await index()
    expect(search(ms, "определител").some((h) => h.title === "Определители")).toBe(true)
    expect(search(ms, "определителя").some((h) => h.title === "Определители")).toBe(true)
    expect(search(ms, "опредилитель").some((h) => h.title === "Определители")).toBe(true)
  })

  it("ё и е — одно и то же", async () => {
    const ms = await index()
    expect(normalize("Отсчёта")).toBe("отсчета")
    expect(search(ms, "отсчета").some((h) => h.title === "Законы Ньютона")).toBe(true)
  })

  it("LaTeX-команды ищутся как слова, карточки закрепа и тулзы тоже", async () => {
    const ms = await index()
    expect(search(ms, "det").some((h) => h.kind === "pin")).toBe(true)
    expect(search(ms, "калькулятор")[0]).toMatchObject({ kind: "tool", title: "Калькулятор матриц" })
  })

  it("несколько слов — пересечение", async () => {
    const ms = await index()
    const hits = search(ms, "бинарный поиск")
    expect(hits.map((h) => h.title)).toContain("Асимптотика и O-нотация")
    expect(hits.every((h) => h.kind !== "tool")).toBe(true)
  })

  it("сниппет вокруг совпадения", () => {
    const text = plainText("# Т\n\nДлинный текст про то, что умножение матриц **не коммутативно**, но ассоциативно.")
    const parts = snippet(text, ["коммутативно"], 10)
    expect(parts.find((p) => p.hit)?.text).toBe("коммутативно")
    expect(parts[0].text.startsWith("…")).toBe(true)
  })
})
