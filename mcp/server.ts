import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { localFilesFrom } from './localFiles'
import { openVault } from './open'
import { createMcpServer } from './tools'

const files = localFilesFrom(process.argv, process.env)
await createMcpServer(await openVault(process.argv, process.env), false, files).connect(new StdioServerTransport())
