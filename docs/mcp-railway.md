# Remote MCP on Railway

The remote MCP service uses Streamable HTTP at `/mcp`. The existing stdio command,
`npm run mcp -- --vault <folder>`, continues to work unchanged.

## Architecture

Run MCP as a **separate service** in the Railway project containing the storage
server. MCP connects to the existing storage service using `STUDYNOTES_LINK` and
`DavAdapter`. Keep the vault on the storage service's persistent Volume; MCP does
not need another Volume or direct access to that disk.

This is a single-owner service. It accepts only the configured OAuth subject and
does not implement multi-user vault routing. Each HTTP request has its own
stateless MCP instance. No sticky sessions or stored MCP sessions are required.

## OAuth prerequisite

Use an external OAuth authorization server. This application is a protected
resource server, not an OAuth authorization server or a login page. Before public
deployment configure a provider that supports:

- OAuth discovery, authorization code flow and PKCE S256;
- a client registration usable by ChatGPT (manual registration or provider-supported
  dynamic registration), with the redirect URI shown by ChatGPT;
- signed JWT **access tokens**, using RS256 or ES256 and published JWKS;
- the exact public MCP URL as the token audience/resource, scope `typos`, and the
  owner's subject as `sub`;
- `exp`, `iat`, `iss`, `aud`, `sub` and a space-separated `scope` claim.

Do not use an ID token as an API access token. Configure the provider to issue
access tokens for this resource and grant consent to this client. A provider that
only issues opaque tokens needs a separate introspection implementation and is
not supported here. Verify resource/audience handling with your provider before
assuming ChatGPT compatibility.

The server verifies JWT signatures and claims against the configured issuer and
JWKS, including the owner's exact subject. It rejects missing, expired, incorrectly
signed or incorrectly scoped tokens. There is no unauthenticated development
mode or shared-secret login. Tokens are not forwarded to the storage server.

## Railway service

1. Add a service from this repository without changing the existing storage
   service. Select **Dockerfile** as builder and set its path to `Dockerfile.mcp`
   in the new service's settings. Do not apply this Dockerfile to the storage
   service. The image uses Node.js 24 and installs the frozen npm lockfile.
2. Generate an HTTPS domain for MCP. Set its healthcheck path to `/healthz`.
   Railway supplies `PORT`; the process listens on `0.0.0.0`.
3. Set the variables below in the MCP service. Enter the connection link securely
   in Railway; never paste it into logs, Git, screenshots or chat.
4. Deploy the service. The process refuses to start without the OAuth settings.
   `/healthz` reports process health only; authenticated MCP calls are needed to
   validate the storage connection.

| Variable | Value |
| --- | --- |
| `MCP_PUBLIC_URL` | Exact HTTPS endpoint, e.g. `https://your-mcp.up.railway.app/mcp` |
| `MCP_AUTH_ISSUER` | Exact issuer from the provider's discovery metadata, including trailing slash if present |
| `MCP_AUTH_JWKS_URL` | HTTPS `jwks_uri` from that metadata |
| `MCP_AUTH_SUBJECT` | Your account's exact `sub` from that provider |
| `STUDYNOTES_LINK` | Dedicated MCP device link created by the existing storage server |

Prefer a dedicated device key so MCP access can be revoked independently. To use
Railway private networking, obtain the existing storage service's private DNS
name and listening port from its configuration. The storage service must listen
on an interface reachable by the MCP service. Use that address in the device link
according to the storage link format; preserve its key and vault ID. Do not
assume the volume path, service hostname or port from this example.

`MCP_PUBLIC_URL` always remains the public HTTPS URL even when storage uses private
networking. Keep public access to MCP behind Railway's HTTPS endpoint. Requests
with a mismatched Host or a foreign Origin are rejected; no browser CORS access
is enabled. ChatGPT's backend connects directly.

The container runs as the unprivileged `node` user. It includes development
dependencies because the existing executable uses `tsx`. No frontend build or
desktop toolchain is required. SIGTERM/SIGINT stops accepting new connections and
allows up to ten seconds for shutdown.

## Connect ChatGPT

In ChatGPT's developer-mode app configuration, use `MCP_PUBLIC_URL` as the MCP
endpoint and OAuth as authentication. Supply client settings from your provider
when requested. The resource publishes metadata at
`/.well-known/oauth-protected-resource/mcp` (also at the root well-known path) and
advertises it in the `WWW-Authenticate` challenge.

Exact UI labels and availability depend on the account and workspace. This code
does not publish a public catalog app. A real provider login and an authenticated
tool call from ChatGPT must be verified after deployment; local transport tests
alone do not establish that integration.

After connecting, verify `list_subjects`, create a disposable note in a test
subject, update and read it, confirm it appears in TYPOS, and send it to the trash.
Do not test writes against existing study notes.

## Remote tool differences

- Remote MCP offers 12 tools. `add_project_file` remains stdio-only because it
  reads local files. Uploading ChatGPT attachments is not implemented.
- `create_note`, `update_note` and `import_tool` accept text inline; local `file`
  arguments are not exposed in their remote schemas.
- `add_image` accepts only `data:image/...;base64` remotely. It rejects local paths
  and URLs. External Markdown images are left in place with a warning, without
  making a network request, to prevent server-side requests to private services.
- HTTP request bodies are limited to 4 MiB. Large documents must be split into
  sections. Images also need to fit within this encoded-body limit.

## Validation

From the repository root run `npm run check`. The HTTP integration tests fetch
real JWKS, verify signed tokens and exercise the MCP client against a real storage
server. They also cover auth rejection, metadata discovery, Host/Origin checks,
body size limits and blocked local-file access. The stdio integration test
continues to exercise the original 13 tools.

To run the HTTP entrypoint outside Railway, provide the same environment variables
and run `npm run mcp:http`; `PORT` defaults to 3000. Public URLs must use HTTPS.
