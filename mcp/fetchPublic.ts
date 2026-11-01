import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

const blocked4 = new BlockList()
const blocked6 = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked4.addSubnet(net, prefix, 'ipv4')

for (const [net, prefix] of [
  ['::', 127],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked6.addSubnet(net, prefix, 'ipv6')

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return !blocked4.check(ip, 'ipv4')
  return family === 6 && !blocked6.check(ip, 'ipv6')
}

const LOCAL = 'Адрес ведёт на этот компьютер или в локальную сеть — такие ссылки MCP не открывает'

export interface FetchOptions {
  maxBytes: number
  timeoutMs?: number
  maxRedirects?: number

  allow?: (ip: string) => boolean
}

export async function fetchPublic(url: string, options: FetchOptions): Promise<{ body: Buffer; type: string }> {
  const { maxBytes, timeoutMs = 30_000, maxRedirects = 5, allow = isPublicAddress } = options
  const signal = AbortSignal.timeout(timeoutMs)
  const lookup: LookupFunction = (hostname, opts, callback) => {
    dnsLookup(hostname, { ...opts, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, '', 0)
      if (!addresses.length || addresses.some((a) => !allow(a.address))) return callback(new Error(LOCAL), '', 0)
      if (opts.all) return (callback as unknown as (e: null, all: LookupAddress[]) => void)(null, addresses)
      callback(null, addresses[0].address, addresses[0].family)
    })
  }

  let current = new URL(url)
  for (let hop = 0; ; hop++) {
    if (current.protocol !== 'https:' && current.protocol !== 'http:') throw new Error('Картинку можно скачать только по http(s)')
    if (current.username || current.password) throw new Error('Ссылка с логином и паролем не подходит')

    const literal = current.hostname.replace(/^\[|\]$/g, '')
    if (isIP(literal) && !allow(literal)) throw new Error(LOCAL)

    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const get = current.protocol === 'https:' ? https.get : http.get
      get(current, { lookup, signal, headers: { accept: 'image/*' } }, resolve).on('error', reject)
    })
    const status = res.statusCode ?? 0
    if ([301, 302, 303, 307, 308].includes(status)) {
      res.resume()
      if (hop >= maxRedirects) throw new Error('Слишком много перенаправлений')
      const location = res.headers.location
      if (!location) throw new Error(`HTTP ${status} без адреса перенаправления`)
      current = new URL(location, current)
      continue
    }
    if (status < 200 || status >= 300) {
      res.resume()
      throw new Error(`HTTP ${status}`)
    }
    const tooBig = () => new Error(`Ответ больше ${Math.round(maxBytes / 1024 / 1024)} МБ`)
    if (Number(res.headers['content-length'] ?? 0) > maxBytes) {
      res.destroy()
      throw tooBig()
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length
      if (size > maxBytes) {
        res.destroy()
        throw tooBig()
      }
      chunks.push(chunk)
    }
    return { body: Buffer.concat(chunks), type: String(res.headers['content-type'] ?? '') }
  }
}
