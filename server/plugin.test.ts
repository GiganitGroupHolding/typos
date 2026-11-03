// @vitest-environment node
import { spawn } from "node:child_process"
import { once } from "node:events"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { expect, it } from "vitest"
import { buildLink, deviceKey, startServer } from "./typos-server.mjs"

const root = path.resolve(import.meta.dirname, "..")

async function run(script: string, config: string, args: string[] = [], input = "") {
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...getDefaultEnvironment(), TYPOS_MCP_CONFIG: config },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
  child.stdin.end(input)
  const [code] = await once(child, "close")
  return { code, stdout, stderr }
}

it("плагин из отдельной папки запускает MCP и пишет в личный сервер по ссылке", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "typos-plugin-"))
  const client = new Client({ name: "plugin-test", version: "1.0.0" })
  let storage: Awaited<ReturnType<typeof startServer>> | undefined
  try {
    storage = await startServer({ dir: path.join(dir, "vault"), port: 0, host: "127.0.0.1" })
    const { token } = await deviceKey(storage.root, "mcp")
    const link = buildLink({ base: `http://127.0.0.1:${storage.port}`, token, name: "Тест", vaultId: storage.state.vaultId })
    const plugin = path.join(dir, "Кэш плагина с пробелами")
    await cp(path.join(root, "plugins/typos"), plugin, { recursive: true })
    const config = path.join(dir, "settings/mcp.json")
    const files = path.join(dir, "Лекции")
    await mkdir(files)
    await writeFile(path.join(files, "lecture.md"), "# Из файла\n")
    const setup = await run(path.join(plugin, "setup.mjs"), config, [root, files], link)
    expect(setup.code).toBe(0)
    expect(setup.stdout + setup.stderr).not.toContain(token)
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({ repo: root, link, files: [files] })

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(plugin, "start.mjs")],
        cwd: dir,
        env: { ...getDefaultEnvironment(), TYPOS_MCP_CONFIG: config, STUDYNOTES_VAULT: dir },
      }),
    )
    expect((await client.listTools()).tools).toHaveLength(16)
    await client.callTool({ name: "create_subject", arguments: { name: "Тест" } })

    const fromFile = await client.callTool({
      name: "create_note",
      arguments: { subject: "Тест", title: "Из файла", file: path.join(files, "lecture.md") },
    })
    expect(fromFile.isError).not.toBe(true)
    const outside = await client.callTool({ name: "add_project_file", arguments: { subject: "Тест", file: config } })
    expect((outside.content as { text: string }[])[0].text).toMatch(/вне разрешённых папок/)
    const result = await client.callTool({ name: "create_note", arguments: { subject: "Тест", title: "Плагин", markdown: "Запись с ПК" } })
    expect(result.isError).not.toBe(true)
    const note = JSON.parse((result.content as { text: string }[])[0].text) as { path: string }
    expect(await readFile(path.join(storage.root, note.path), "utf8")).toContain("Запись с ПК")
  } finally {
    await client.close()
    await storage?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it("повреждённые настройки не раскрывают секретную ссылку в сообщении запуска", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "typos-plugin-invalid-"))
  try {
    const config = path.join(dir, "mcp.json")
    const secret = "typos://example.com/?k=секретный-ключ"
    await writeFile(config, `{"link":"${secret}`)
    const result = await run(path.join(root, "plugins/typos/start.mjs"), config)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("Сначала настрой плагин")
    expect(result.stderr).not.toContain(secret)
    const rejected = await run(path.join(root, "plugins/typos/setup.mjs"), config, [root], "не ссылка")
    expect(rejected.code).toBe(1)
    expect(await readFile(config, "utf8")).toBe(`{"link":"${secret}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
