import { createHttpMcpServer, createTokenVerifier, httpConfig, publicMcpUrl } from './http'
import { openVault } from './open'
import { createOwnerAuth, ownerAuthConfig } from './ownerAuth'

const mode = process.env.MCP_AUTH_MODE ?? 'external'
if (!['owner', 'external'].includes(mode)) throw new Error('MCP_AUTH_MODE должен быть owner или external')
const owner = mode === 'owner' ? createOwnerAuth(ownerAuthConfig(publicMcpUrl(process.env), process.env)) : undefined
const config = owner
  ? {
      resource: owner.provider.config.resource,
      issuer: new URL('/', owner.provider.config.resource).href,
      scopes: ['typos', 'offline_access'],
    }
  : httpConfig(process.env)
const verifyToken = owner ? (token: string) => owner.provider.verifyAccessToken(token) : createTokenVerifier(httpConfig(process.env))
const port = Number(process.env.PORT ?? '3000')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть целым числом от 1 до 65535')
const server = createHttpMcpServer(await openVault(process.argv, process.env), config, verifyToken, owner?.app)
server.listen(port, '0.0.0.0', () => console.error(`MCP HTTP запущен на порту ${port}`))
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
