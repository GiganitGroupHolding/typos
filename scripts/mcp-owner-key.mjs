import { randomBytes, scryptSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = process.argv[2]
if (!file || !path.isAbsolute(file)) throw new Error('Укажи абсолютный путь к новому файлу ключа вне репозитория')
const relative = path.relative(fileURLToPath(new URL('..', import.meta.url)), file)
if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)))
  throw new Error('Сохрани ключ вне репозитория, чтобы не отправить его в Git')
const key = randomBytes(32).toString('base64url')
const salt = randomBytes(16)
const passwordHash = `scrypt:${salt.toString('base64url')}:${scryptSync(key, salt, 32).toString('base64url')}`
// Открытый ключ записывается только в личный файл, а в Railway передаётся хэш.
writeFileSync(file, `${key}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ file, MCP_OWNER_PASSWORD_HASH: passwordHash }))
