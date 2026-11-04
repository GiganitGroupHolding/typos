import { afterEach, expect, it, vi } from "vitest"
import { RemoteAdapter } from "./remoteAdapter"

afterEach(() => vi.restoreAllMocks())

const adapter = () => new RemoteAdapter({ url: "https://vault.example", token: "test", name: "Тест", vaultId: "test" })

it.each(["GET", "PUT"])("использует каноническую версию файла для %s, даже если прокси изменил ETag", async (method) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(method === "GET" ? "текст" : null, {
      status: method === "GET" ? 200 : 204,
      headers: { "X-Typos-ETag": '"canonical"', ETag: 'W/"proxy"' },
    }),
  )
  const res = method === "GET" ? await adapter().get("a.md") : await adapter().put("a.md", new Blob(["текст"]))
  expect(res).toMatchObject({ etag: '"canonical"' })
})

it.each(["GET", "PUT"])("поддерживает старый сервер с обычным ETag для %s", async (method) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(method === "GET" ? "текст" : null, {
      status: method === "GET" ? 200 : 204,
      headers: { ETag: '"legacy"' },
    }),
  )
  const res = method === "GET" ? await adapter().get("a.md") : await adapter().put("a.md", new Blob(["текст"]))
  expect(res).toMatchObject({ etag: '"legacy"' })
})

it.each([null, "", 'W/"weak"', "invalid"])("отклоняет отсутствующую или ненадёжную версию файла: %s", async (etag) => {
  const headers = new Headers()
  if (etag !== null) headers.set("ETag", etag)
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("текст", { headers }))
  await expect(adapter().get("a.md")).rejects.toMatchObject({ status: 502 })
  await expect(adapter().put("a.md", new Blob(["текст"]))).rejects.toMatchObject({ status: 502 })
})

it("сохраняет ответы об отсутствии файла и конфликте без заголовка версии", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 412 }))
  expect(await adapter().get("a.md")).toBeNull()
  expect(await adapter().put("a.md", new Blob(["текст"]), '"old"')).toBe("conflict")
})
