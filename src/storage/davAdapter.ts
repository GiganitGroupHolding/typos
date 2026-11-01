import { RemoteAdapter, RemoteError } from './remoteAdapter'
import type { Entry, VaultAdapter } from './VaultAdapter'

const tag = (name: string) => `<(?:[\\w-]+:)?${name}\\b`
const RESPONSE = new RegExp(`${tag('response')}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?response>`, 'g')
const HREF = new RegExp(`${tag('href')}[^>]*>([^<]*)<`)
const COLLECTION = new RegExp(tag('collection'))
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s: string) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, hex?: string, dec?: string, name?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : (ENTITIES[name!] ?? m),
  )

export function parseListing(xml: string): Entry[] {
  const items = [...xml.matchAll(RESPONSE)].map(([, body]) => {
    const href = unescapeXml(HREF.exec(body)?.[1] ?? '')
    const segments = new URL(href, 'http://x').pathname.split('/').filter(Boolean).map(decodeURIComponent)
    return { segments, isDir: COLLECTION.test(body) }
  })
  if (!items.length) return []
  const depth = Math.min(...items.map((i) => i.segments.length))
  return items.filter((i) => i.segments.length === depth + 1).map((i) => ({ name: i.segments.at(-1)!, kind: i.isDir ? 'dir' : 'file' }))
}

export class DavAdapter extends RemoteAdapter implements VaultAdapter {
  readonly kind = 'remote' as const

  get label() {
    return this.config.name
  }

  async list(dir: string): Promise<Entry[]> {
    const res = await this.request(this.fileUrl(dir, true), { method: 'PROPFIND', headers: { Depth: '1' } }, [404])
    return res.status === 404 ? [] : parseListing(await res.text())
  }

  async readText(path: string) {
    const res = await this.request(this.fileUrl(path), {}, [404])
    return res.status === 404 ? null : await res.text()
  }

  async readBlob(path: string) {
    return (await this.get(path))?.blob ?? null
  }

  async writeText(path: string, text: string) {
    await this.request(this.fileUrl(path), { method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  async writeBlob(path: string, blob: Blob) {
    await this.request(this.fileUrl(path), {
      method: 'PUT',
      body: await blob.arrayBuffer(),
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    })
  }

  async exists(path: string) {
    const res = await this.request(this.fileUrl(path), { method: 'PROPFIND', headers: { Depth: '0' } }, [404])
    return res.status !== 404
  }

  async remove(path: string) {
    await this.request(this.fileUrl(path), { method: 'DELETE' }, [404])
  }

  async move(from: string, to: string) {
    if (from === to) return
    const res = await this.request(
      this.fileUrl(from),
      { method: 'MOVE', headers: { Destination: this.fileUrl(to), Overwrite: 'F' } },
      [412],
    )
    if (res.status === 412) throw new RemoteError(`Уже существует: ${to}`, 412)
  }
}
