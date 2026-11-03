import "fake-indexeddb/auto"
import type { Editor } from "@tiptap/core"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useUi } from "@/app/store"
import { sampleVault } from "@/test/sampleVault"
import { serializeFrontmatter } from "@/vault/format"
import * as repo from "@/vault/repo"
import { useVault } from "@/vault/store"
import { NoteEditor } from "./NoteEditor"

vi.mock("./SideToolbar", () => ({ SideToolbar: () => null }))
vi.mock("./BubbleToolbar", () => ({ BubbleToolbar: () => null }))
vi.mock("./TableMenu", () => ({ TableMenu: () => null }))
vi.mock("./MathPopover", () => ({ MathPopover: () => null }))
vi.mock("./blocks/BlockHandle", () => ({ BlockHandle: () => null }))
vi.mock("./map/NoteCanvas", () => ({ NoteCanvas: () => null }))
vi.mock("@/features/pins/PinEditorDialog", () => ({ openPinEditor: vi.fn() }))
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)

let root: Root
let host: HTMLDivElement
let adapter: ReturnType<typeof sampleVault>

beforeEach(async () => {
  vi.useFakeTimers()
  adapter = sampleVault()
  const data = await repo.loadVault(adapter)
  const note = data.notes[0]
  note.body = "# Формулы\n\n\\(x^2\\)\n\n\nБез правок"
  await adapter.writeText(note.path, serializeFrontmatter({ id: note.id, created: note.created, updated: note.updated }, note.body))
  useVault.setState({ ...data, adapter, status: "ready" })
  useUi.setState({ readingMode: false })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function openNote() {
  const note = useVault.getState().notes[0]
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(NoteEditor, { note }))))
  await act(async () => vi.advanceTimersByTimeAsync(600))
  return (host.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor
}

it("показывает объединённый текст после независимых правок MCP и пользователя", async () => {
  const note = useVault.getState().notes[0]
  const base = "# План\n\nПервый раздел\n\nВторой раздел"
  const write = (body: string) =>
    adapter.writeText(note.path, serializeFrontmatter({ id: note.id, created: note.created, updated: note.updated }, body))
  await write(base)
  await useVault.getState().refresh()
  const editor = await openNote()
  await write(base.replace("Первый раздел", "Правка агента"))
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " — правка пользователя")
  })
  await act(async () => vi.advanceTimersByTimeAsync(600))
  expect(editor.getMarkdown()).toContain("Правка агента")
  expect(editor.getMarkdown()).toContain("Второй раздел — правка пользователя")
  const saved = useVault.getState().notes.find((n) => n.id === note.id)!
  expect(await repo.readNoteBody(adapter, saved.path)).toBe(editor.getMarkdown())
})

it("не теряет ввод во время медленного сохранения со слиянием", async () => {
  const note = useVault.getState().notes[0]
  const base = "# План\n\nПервый раздел\n\nВторой раздел"
  const write = (body: string) =>
    adapter.writeText(note.path, serializeFrontmatter({ id: note.id, created: note.created, updated: note.updated }, body))
  await write(base)
  await useVault.getState().refresh()
  const editor = await openNote()
  await write(base.replace("Первый раздел", "Правка агента"))
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const read = adapter.readText.bind(adapter)
  vi.spyOn(adapter, "readText").mockImplementationOnce(async (path) => {
    const text = await read(path)
    await gate
    return text
  })
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " — моя правка")
  })
  await act(async () => vi.advanceTimersByTimeAsync(500))
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " и продолжение")
  })
  await act(async () => vi.advanceTimersByTimeAsync(500))
  await act(async () => {
    release()
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(editor.getMarkdown()).toContain("Правка агента")
  expect(editor.getMarkdown()).toContain("Второй раздел — моя правка и продолжение")
  const saved = useVault.getState().notes.find((n) => n.id === note.id)!
  expect(await repo.readNoteBody(adapter, saved.path)).toBe(editor.getMarkdown())
})

it("открытие, выделение и режим чтения не меняют файл или дату конспекта", async () => {
  const note = useVault.getState().notes[0]
  const original = await adapter.readText(note.path)
  const write = vi.spyOn(adapter, "writeText")
  const editor = await openNote()
  expect(host.textContent).toContain("Без правок")
  await act(async () => {
    editor.commands.setTextSelection(3)
    useUi.getState().toggleReading()
  })
  await act(async () => vi.advanceTimersByTimeAsync(600))
  await act(async () => useUi.getState().toggleReading())
  await act(async () => vi.advanceTimersByTimeAsync(600))
  await act(async () => root.unmount())
  expect(write).not.toHaveBeenCalled()
  expect(await adapter.readText(note.path)).toBe(original)
  expect(useVault.getState().notes[0].updated).toBe(note.updated)
})

it("настоящая правка по-прежнему сохраняется после задержки", async () => {
  const editor = await openNote()
  const write = vi.spyOn(adapter, "writeText")
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " — дописано")
  })
  await act(async () => vi.advanceTimersByTimeAsync(600))
  expect(write).toHaveBeenCalledOnce()
  expect(useVault.getState().notes[0].body).toContain("дописано")
})
