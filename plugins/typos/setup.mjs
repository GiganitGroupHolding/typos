import path from "node:path"
import { saveConfig } from "./config.mjs"

try {
  const [repo, ...files] = process.argv.slice(2)
  if (!repo) throw new Error("Укажи путь к репозиторию: node plugins/typos/setup.mjs ПУТЬ [ПАПКА_С_ФАЙЛАМИ…]")
  if (process.stdin.isTTY) throw new Error("Передай ссылку через stdin, не через аргументы. См. README.md.")
  let link = ""
  for await (const chunk of process.stdin) {
    link += chunk.toString()
    if (link.length > 16_384) throw new Error("Ссылка слишком длинная. Передай только ссылку TYPOS.")
  }
  await saveConfig({ repo, link: link.trim(), files: files.map((f) => path.resolve(f)) })
  console.log("Плагин TYPOS настроен.")
  console.log(
    files.length
      ? `Разрешённые папки: ${files.map((f) => path.resolve(f)).join(", ")}`
      : "Доступ к файлам отключён. Для доступа добавь путь к папке при настройке.",
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : "Не получилось сохранить настройки плагина TYPOS")
  process.exitCode = 1
}
