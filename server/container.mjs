#!/usr/bin/env node
import { promises as fs } from "node:fs"
import path from "node:path"
import { main } from "./typos-server.mjs"

const UID = 1000
const GID = 1000

/** @param {string} p */
async function chownTree(p) {
  const st = await fs.lstat(p)
  if (st.uid !== UID || st.gid !== GID) await fs.lchown(p, UID, GID)
  if (!st.isDirectory()) return
  for (const name of await fs.readdir(p)) await chownTree(path.join(p, name))
}

const args = process.argv.slice(2)
const dir = path.resolve(process.env.TYPOS_VAULT ?? "/data/vault")
if (process.getuid?.() === 0) {
  await fs.mkdir(dir, { recursive: true })

  for (let up = path.dirname(dir); up !== path.dirname(up); up = path.dirname(up)) {
    const { mode } = await fs.stat(up)
    if (!(mode & 0o001)) await fs.chmod(up, (mode & 0o7777) | 0o001)
  }
  await chownTree(dir)
  process.setgroups?.([])
  process.setgid?.(GID)
  process.setuid?.(UID)
}
if (process.getuid?.() === 0) throw new Error("Не получилось сбросить права root — сервер хранения не запущен")

if (process.env.PORT && !args.some((a) => a === "--port" || a.startsWith("--port="))) args.push("--port", process.env.PORT)
await main(["serve", "--dir", dir, ...args])
