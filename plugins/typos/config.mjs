import { randomUUID } from "node:crypto"
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

export const configPath = () => process.env.TYPOS_MCP_CONFIG || path.join(homedir(), ".typos", "mcp.json")

export async function validateConfig(value) {
  if (!value || typeof value !== "object" || typeof value.repo !== "string" || !path.isAbsolute(value.repo))
    throw new Error("Укажи абсолютный путь к репозиторию TYPOS")
  if (typeof value.link !== "string" || !/^typos:\/\//i.test(value.link)) throw new Error("Нужна полная ссылка подключения TYPOS")
  try {
    const link = new URL(value.link.replace(/^typos:\/\//i, "http://"))
    if (!link.host || !link.searchParams.get("k")) throw new Error()
  } catch {
    throw new Error("Ссылка TYPOS повреждена. Скопируй её целиком.")
  }

  const files = value.files ?? []
  if (!Array.isArray(files) || !files.every((f) => typeof f === "string" && path.isAbsolute(f)))
    throw new Error("В files укажи список абсолютных путей к папкам")
  try {
    await access(path.join(value.repo, "mcp/server.ts"))
    await access(path.join(value.repo, "mcp/tsconfig.json"))
    await access(path.join(value.repo, "node_modules/tsx/dist/cli.mjs"))
  } catch {
    throw new Error("Не найдены MCP или зависимости. Выполни npm ci в папке TYPOS.")
  }
  return { repo: value.repo, link: value.link.trim(), ...(files.length ? { files } : {}) }
}

export async function loadConfig() {
  let value
  try {
    value = JSON.parse(await readFile(configPath(), "utf8"))
  } catch {
    throw new Error("Сначала настрой плагин по инструкции plugins/typos/README.md в репозитории TYPOS")
  }
  return validateConfig(value)
}

export async function saveConfig(value) {
  const config = await validateConfig(value)
  const file = configPath()
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" })
    await rename(temp, file)
  } finally {
    await rm(temp, { force: true })
  }
}
