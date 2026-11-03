import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from "node:http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"
import type { VaultAdapter } from "@/storage/VaultAdapter"
import { createMcpServer } from "./tools"

export interface HttpResourceConfig {
  resource: URL
  issuer: string
  scopes?: string[]
}

export interface HttpConfig extends HttpResourceConfig {
  jwksUrl: URL
  subject: string
}

export function publicMcpUrl(env: NodeJS.ProcessEnv): URL {
  const value = env.MCP_PUBLIC_URL?.trim()
  if (!value) throw new Error("Задай MCP_PUBLIC_URL в настройках MCP-сервиса")
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("MCP_PUBLIC_URL должен быть HTTPS-адресом без ключей и параметров")
  if (url.pathname !== "/mcp") throw new Error("MCP_PUBLIC_URL должен заканчиваться на /mcp")
  return url
}

export function httpConfig(env: NodeJS.ProcessEnv): HttpConfig {
  const required = (name: string) => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Задай ${name} в настройках MCP-сервиса`)
    return value
  }
  const https = (name: string) => {
    const url = new URL(required(name))
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw new Error(`${name} должен быть HTTPS-адресом без ключей и параметров`)
    return url
  }
  const resource = publicMcpUrl(env)
  const issuer = required("MCP_AUTH_ISSUER")
  https("MCP_AUTH_ISSUER")
  return { resource, issuer, jwksUrl: https("MCP_AUTH_JWKS_URL"), subject: required("MCP_AUTH_SUBJECT") }
}

export function createTokenVerifier(config: HttpConfig, key: JWTVerifyGetKey = createRemoteJWKSet(config.jwksUrl)) {
  return async (token: string) => {
    const { payload } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.resource.href,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["exp", "iat", "sub"],
    })
    if (payload.sub !== config.subject || typeof payload.scope !== "string" || !payload.scope.split(" ").includes("typos"))
      throw new Error("Нет доступа к этому хранилищу")
  }
}

export function createHttpMcpServer(
  adapter: VaultAdapter,
  config: HttpResourceConfig,
  verifyToken: (token: string) => Promise<unknown>,
  authHandler?: RequestListener,
) {
  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    res.end(JSON.stringify(data))
  }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz" && req.method === "GET") return json(res, 200, { status: "ok" })
    if (req.headers.host !== config.resource.host || (req.headers.origin && req.headers.origin !== config.resource.origin))
      return json(res, 403, { error: "Недопустимый Host или Origin" })
    if (
      (req.url === "/.well-known/oauth-protected-resource" || req.url === "/.well-known/oauth-protected-resource/mcp") &&
      req.method === "GET"
    ) {
      return json(res, 200, {
        resource: config.resource.href,
        authorization_servers: [config.issuer],
        scopes_supported: config.scopes ?? ["typos"],
        bearer_methods_supported: ["header"],
      })
    }
    if (req.url !== "/mcp") {
      if (authHandler) return authHandler(req, res)
      return json(res, 404, { error: "Не найдено" })
    }
    const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
    try {
      if (!token) throw new Error("Нет ключа доступа")
      await verifyToken(token)
    } catch {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${config.resource.origin}/.well-known/oauth-protected-resource/mcp", scope="typos"`,
      )
      return json(res, 401, { error: "Войди через OAuth, чтобы открыть хранилище" })
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST")
      return json(res, 405, { error: "Используй POST для MCP-запросов" })
    }
    const mcp = createMcpServer(adapter, true)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 4 * 1024 * 1024,
    })
    res.once("close", () => void mcp.close().catch(() => {}))
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  }
  return createServer({ requestTimeout: 60_000, headersTimeout: 15_000 }, (req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "Ошибка MCP-сервера" })
      else res.destroy()
    })
  })
}
