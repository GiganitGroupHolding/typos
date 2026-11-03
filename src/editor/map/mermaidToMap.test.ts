import { describe, expect, it } from "vitest"
import { blockSize, layoutFlow, parseFlowchart } from "./mermaidToMap"
import { codeHash, parseNoteMap, resolveBlock, serializeNoteMap, type NoteMap } from "./types"

const measure = (t: string) => blockSize(t, (line) => line.length * 8)

describe("mermaid → карта", () => {
  it("схемы из лекции: узлы, подписи, <br/>, цикл", () => {
    const a = parseFlowchart(
      "flowchart TD\n  S[Виды сегментирования] --> A[Потребители]\n  S --> B[Деловой рынок]\n  S --> C[Товарный рынок]\n  S --> D[Конкуренты]",
    )!
    expect(a.dir).toBe("TB")
    expect(a.nodes.map((n) => n.text)).toEqual(["Виды сегментирования", "Потребители", "Деловой рынок", "Товарный рынок", "Конкуренты"])
    expect(a.edges).toHaveLength(4)

    const b = parseFlowchart(
      "flowchart LR\n  A[Анализ] --> B[Планирование]\n  B --> C[Производство<br/>и сбыт]\n  C --> D[Контроль]\n  D --> E[Оценка]\n  E --> A",
    )!
    expect(b.dir).toBe("LR")
    expect(b.nodes.find((n) => n.id === "C")?.text).toBe("Производство\nи сбыт")
    expect(b.edges.at(-1)).toEqual({ from: "E", to: "A", label: undefined })
  })

  it("формы, стрелки, подписи, цепочки и &", () => {
    const f = parseFlowchart(
      [
        "graph TD;",
        '  A(("Круг, с запятой")) -->|да| B{Ромб}',
        "  B -- нет --> C([Стадион]) -.-> D[[Подпрограмма]]",
        "  B ==> E>Флажок] --- F{{Шестиугольник}}",
        "  F & E --> G[/Параллелограмм/]",
        "  subgraph Блок",
        "    G <--> H[(База)]",
        "  end",
        "  classDef x fill:#f00",
        "  %% комментарий --> X",
      ].join("\n"),
    )!
    expect(f.nodes.map((n) => n.text)).toEqual([
      "Круг, с запятой",
      "Ромб",
      "Стадион",
      "Подпрограмма",
      "Флажок",
      "Шестиугольник",
      "Параллелограмм",
      "База",
    ])
    expect(f.edges).toContainEqual({ from: "A", to: "B", label: "да" })
    expect(f.edges).toContainEqual({ from: "B", to: "C", label: "нет" })
    expect(f.edges).toContainEqual({ from: "C", to: "D", label: undefined })
    expect(
      f.edges
        .filter((e) => e.to === "G")
        .map((e) => e.from)
        .sort(),
    ).toEqual(["E", "F"])
    expect(f.edges).toContainEqual({ from: "G", to: "H", label: undefined })
    expect(f.nodes.some((n) => n.id === "X")).toBe(false)
  })

  it("не flowchart — не переводится", () => {
    expect(parseFlowchart("sequenceDiagram\n  A->>B: привет")).toBeNull()
    expect(parseFlowchart('pie title Доли\n  "A" : 1')).toBeNull()
  })

  it("раскладка: блоки не пересекаются, сверху вниз по рангам", async () => {
    const flow = parseFlowchart(
      "flowchart TD\n  S[Виды сегментирования] --> A[Потребители]\n  S --> B[Деловой рынок]\n  S --> C[Товарный рынок]\n  A --> Z[Итог]",
    )!
    const l = await layoutFlow(flow, measure)
    expect(Math.min(...l.nodes.map((n) => n.x))).toBe(0)
    expect(Math.min(...l.nodes.map((n) => n.y))).toBe(0)
    for (const p of l.nodes)
      for (const q of l.nodes) {
        if (p === q) continue
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
        expect(overlap, `${p.id} и ${q.id}`).toBe(false)
      }
    const y = (id: string) => l.nodes.find((n) => n.id === id)!.y
    expect(y("S")).toBeLessThan(y("A"))
    expect(y("A")).toBeLessThan(y("Z"))
    expect(l.width).toBeGreaterThan(0)
  })
})

describe("файл карты", () => {
  it("сохраняется и читается; битое отбрасывается", () => {
    const map: NoteMap = {
      version: 1,
      groups: [{ id: "g1", anchor: { kind: "block", text: "Сегментирование", index: 2 } }],
      nodes: [
        { id: "n1", group: "g1", x: 10, y: 4, w: 140, h: 44, text: "Анализ" },
        { id: "n2", group: "g1", x: 200, y: 4, w: 140, h: 44, text: "План" },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2" }],
    }
    expect(parseNoteMap(serializeNoteMap(map))).toEqual(map)
    const broken = JSON.stringify({
      groups: [{ id: "g1", anchor: { kind: "abs", y: 5 } }, { id: "x" }],
      nodes: [
        { id: "n", group: "nope" },
        { id: "m", group: "g1", w: 1 },
      ],
      edges: [{ id: "e", from: "m", to: "zz" }],
    })
    expect(parseNoteMap(broken)).toEqual({
      version: 1,
      groups: [{ id: "g1", anchor: { kind: "abs", y: 5 } }],
      nodes: [{ id: "m", group: "g1", x: 0, y: 0, w: 40, h: 44, text: "" }],
      edges: [],
    })
    expect(parseNoteMap("{не json")).toEqual({ version: 1, groups: [], nodes: [], edges: [] })
  })

  it("якорь: по началу текста, при повторах — ближайший по номеру", () => {
    const blocks = ["# Заголовок", "Сегментирование рынка — это", "Пример", "Сегментирование рынка — это повтор"]
    expect(resolveBlock(blocks, { text: "Сегментирование рынка — это", index: 3 })).toBe(3)
    expect(resolveBlock(blocks, { text: "Сегментирование рынка — это", index: 0 })).toBe(1)

    expect(resolveBlock(blocks, { text: "Удалённый текст", index: 2 })).toBe(2)
    expect(resolveBlock([], { text: "x", index: 0 })).toBe(-1)
  })

  it("хеш кода не зависит от пробелов", () => {
    expect(codeHash("flowchart TD\n  A --> B")).toBe(codeHash("flowchart TD\nA  -->  B\n"))
    expect(codeHash("flowchart TD\nA --> B")).not.toBe(codeHash("flowchart TD\nA --> C"))
  })
})
