import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { openVault } from './open'
import { createMcpServer } from './tools'

await createMcpServer(await openVault(process.argv, process.env)).connect(new StdioServerTransport())
