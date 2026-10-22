import { saveConfig } from './config.mjs'

try {
  const repo = process.argv[2]
  if (!repo) throw new Error('Укажи путь к репозиторию: node plugins/typos/setup.mjs ПУТЬ')
  if (process.stdin.isTTY) throw new Error('Передай ссылку через стандартный ввод по инструкции README.md — не через аргументы команды')
  let link = ''
  for await (const chunk of process.stdin) {
    link += chunk.toString()
    if (link.length > 16_384) throw new Error('Ссылка слишком длинная — проверь, что скопирована только ссылка TYPOS')
  }
  await saveConfig({ repo, link: link.trim() })
  console.log('Плагин TYPOS настроен. Ссылка сохранена локально вне репозитория.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Не получилось сохранить настройки плагина TYPOS')
  process.exitCode = 1
}
