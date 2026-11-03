// @vitest-environment node
import { once } from "node:events"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fetchPublic, isPublicAddress } from "./fetchPublic"

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/pic") return res.writeHead(200, { "Content-Type": "image/png" }).end("png")
    if (req.url === "/to-lan") return res.writeHead(302, { Location: "http://127.0.0.2:9/secret" }).end()
    if (req.url === "/loop") return res.writeHead(302, { Location: "/loop" }).end()
    if (req.url === "/big") {
      res.writeHead(200, { "Content-Type": "image/png" })
      for (let i = 0; i < 64; i++) res.write(Buffer.alloc(32 * 1024))
      return res.end()
    }
    res.writeHead(404).end()
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const onlyTestServer = (ip: string) => ip === "127.0.0.1"

describe("скачивание картинок по ссылке", () => {
  it("отличает адреса интернета от локальных и служебных", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip)).toBe(true)
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "64:ff9b::a00:1",
      "localhost",
    ])
      expect(isPublicAddress(ip), ip).toBe(false)
  })

  it("не ходит на localhost и в локальную сеть — ни напрямую, ни через DNS", async () => {
    await expect(fetchPublic(`${base}/pic`, { maxBytes: 1024 })).rejects.toThrow(/локальную сеть/)
    const port = (server.address() as AddressInfo).port
    await expect(fetchPublic(`http://localhost:${port}/pic`, { maxBytes: 1024 })).rejects.toThrow(/локальную сеть/)
    await expect(fetchPublic(`http://[::1]:${port}/pic`, { maxBytes: 1024 })).rejects.toThrow(/локальную сеть/)
  })

  it("проверяет адрес после каждого перенаправления", async () => {
    expect((await fetchPublic(`${base}/pic`, { maxBytes: 1024, allow: onlyTestServer })).body.toString()).toBe("png")
    await expect(fetchPublic(`${base}/to-lan`, { maxBytes: 1024, allow: onlyTestServer })).rejects.toThrow(/локальную сеть/)
    await expect(fetchPublic(`${base}/loop`, { maxBytes: 1024, allow: onlyTestServer })).rejects.toThrow(/перенаправлений/)
  })

  it("обрывает ответ больше предела, не дочитывая его в память", async () => {
    await expect(fetchPublic(`${base}/big`, { maxBytes: 100 * 1024, allow: onlyTestServer })).rejects.toThrow(/больше/)
  })

  it("принимает только http и https", async () => {
    await expect(fetchPublic("file:///etc/passwd", { maxBytes: 1024 })).rejects.toThrow(/только по http/)
  })
})
