import path from "node:path"
import { saveConfig } from "./config.mjs"

try {
  const [repo, ...files] = process.argv.slice(2)
  if (!repo) throw new Error("Укажи путь к репозиторию: node plugins/typos/setup.mjs ПУТЬ [ПАПКА_С_ФАЙЛАМИ…]")
  if (process.stdin.isTTY) throw new Error("Передай ссылку через стандартный ввод по инструкции README.md — не через аргументы команды")
  let link = ""
  for await (const chunk of process.stdin) {
    link += chunk.toString()
    if (link.length > 16_384) throw new Error("Ссылка слишком длинная — проверь, что скопирована только ссылка TYPOS")
  }
  await saveConfig({ repo, link: link.trim(), files: files.map((f) => path.resolve(f)) })
  console.log("Плагин TYPOS настроен. Ссылка сохранена локально вне репозитория.")
  console.log(
    files.length
      ? `MCP может читать файлы только из папок: ${files.map((f) => path.resolve(f)).join(", ")}`
      : "Файлы компьютера MCP не читает. Разрешить папку: запусти настройку снова и добавь путь к ней после пути к репозиторию.",
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : "Не получилось сохранить настройки плагина TYPOS")
  process.exitCode = 1
}
