import "fake-indexeddb/auto"
import { expect, it, vi } from "vitest"
import { NOTES_DIR, parseFrontmatter, serializeFrontmatter } from "@/vault/format"
import { SyncedAdapter } from "./syncedAdapter"

const path = `Предмет/${NOTES_DIR}/План.md`
const base = "# План\n\nПервый раздел\n\nВторой раздел"
const file = (body: string, updated: string) => serializeFrontmatter({ id: "note", created: "2026-01-01", updated }, body)

async function setup() {
  const files = new Map([[path, { text: file(base, "2026-01-01"), etag: "1" }]])
  let revision = 1
  const write = (p: string, text: string) => {
    const value = { text, etag: String(++revision) }
    files.set(p, value)
    return value
  }
  const adapter = new SyncedAdapter({ url: "http://localhost", token: "test", name: "Тест", vaultId: crypto.randomUUID() })
  vi.spyOn(adapter.remote, "manifest").mockImplementation(async () => ({
    files: Object.fromEntries([...files].map(([p, value]) => [p, { etag: value.etag, size: value.text.length, mtime: "" }])),
    dirs: [],
  }))
  vi.spyOn(adapter.remote, "get").mockImplementation(async (p) => {
    const value = files.get(p)
    return value ? { blob: new Blob([value.text]), etag: value.etag } : null
  })
  vi.spyOn(adapter.remote, "put").mockImplementation(async (p, blob, etag) => {
    if (files.get(p)?.etag !== etag) return "conflict"
    return { etag: write(p, await blob.text()).etag }
  })
  await adapter.initialSync()
  const conflict = vi.fn()
  adapter.engine.hooks.onConflict = conflict
  return { adapter, files, write, conflict }
}

it("синхронизирует независимые правки и обновляет общую базу для следующего слияния", async () => {
  const { adapter, files, write, conflict } = await setup()
  try {
    await adapter.writeText(path, file(base.replace("Второй раздел", "Правка пользователя"), "2026-01-02"))
    write(path, file(base.replace("Первый раздел", "Правка агента"), "2026-01-03"))
    await adapter.engine.syncNow()
    const expected = "# План\n\nПравка агента\n\nПравка пользователя"
    expect(parseFrontmatter((await adapter.readText(path))!).body).toBe(expected)
    expect(parseFrontmatter(files.get(path)!.text).body).toBe(expected)
    expect(conflict).not.toHaveBeenCalled()
    expect(await adapter.engine.countPending()).toBe(0)
    await adapter.writeText(path, file(expected.replace("Правка пользователя", "Ещё правка"), "2026-01-04"))
    write(path, file(expected.replace("Правка агента", "Ещё от агента"), "2026-01-05"))
    await adapter.engine.syncNow()
    expect(parseFrontmatter(files.get(path)!.text).body).toBe("# План\n\nЕщё от агента\n\nЕщё правка")
    expect(conflict).not.toHaveBeenCalled()
  } finally {
    adapter.stop()
  }
})

it("сохраняет конфликтную копию при разных правках одной строки", async () => {
  const { adapter, files, write, conflict } = await setup()
  try {
    await adapter.writeText(path, file(base.replace("Второй раздел", "Моя версия"), "2026-01-02"))
    write(path, file(base.replace("Второй раздел", "Версия агента"), "2026-01-03"))
    await adapter.engine.syncNow()
    expect(conflict).toHaveBeenCalledOnce()
    expect(parseFrontmatter(files.get(path)!.text).body).toContain("Версия агента")
    expect([...files.values()].some((value) => value.text.includes("Моя версия"))).toBe(true)
  } finally {
    adapter.stop()
  }
})
