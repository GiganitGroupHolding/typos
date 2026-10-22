import { createHttpMcpServer, httpConfig } from './http'
import { openVault } from './open'

const config = httpConfig(process.env)
const port = Number(process.env.PORT ?? '3000')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть целым числом от 1 до 65535')
const server = createHttpMcpServer(await openVault(process.argv, process.env), config)
server.listen(port, '0.0.0.0', () => console.error(`MCP HTTP запущен на порту ${port}`))
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
