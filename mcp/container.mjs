import { chmodSync, chownSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'

if (process.getuid?.() === 0) {
  if (process.env.MCP_AUTH_MODE === 'owner') {
    if (process.env.MCP_AUTH_DATA_DIR !== '/data/auth') throw new Error('В контейнере используй MCP_AUTH_DATA_DIR=/data/auth')
    chmodSync('/data', 0o711)
    mkdirSync('/data/auth', { recursive: true, mode: 0o700 })
    chownSync('/data/auth', 1000, 1000)
    chmodSync('/data/auth', 0o700)
  }
  process.setgroups([])
  process.setgid(1000)
  process.setuid(1000)
}

register({ tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)) })
await import('./httpServer.ts')
