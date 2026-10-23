import { spawn } from 'node:child_process'
import path from 'node:path'
import { loadConfig } from './config.mjs'

try {
  const { repo, link, files = [] } = await loadConfig()
  // Запуск из кэша плагинов не должен менять базу относительных путей MCP.
  const child = spawn(
    process.execPath,
    [
      path.join(repo, 'node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      path.join(repo, 'mcp/tsconfig.json'),
      path.join(repo, 'mcp/server.ts'),
    ],
    {
      cwd: repo,
      stdio: 'inherit',
      env: { ...process.env, STUDYNOTES_LINK: link, STUDYNOTES_VAULT: '', STUDYNOTES_FILES: files.join(path.delimiter) },
      windowsHide: true,
    },
  )
  child.once('error', () => {
    console.error('Не получилось запустить MCP TYPOS — проверь Node.js и зависимости репозитория')
    process.exitCode = 1
  })
  child.once('exit', (code) => {
    process.exitCode = code ?? 1
  })
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Не получилось прочитать настройки плагина TYPOS')
  process.exitCode = 1
}
