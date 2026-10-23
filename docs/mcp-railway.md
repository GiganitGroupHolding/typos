# Remote MCP on Railway

Run MCP as a separate Railway service connected to your existing TYPOS storage
server. ChatGPT connects to its HTTPS `/mcp` endpoint; the desktop app and your
computer do not need to be running. Everyone hosts their own MCP and vault.

The local stdio command and desktop plugin keep working independently.

## Single-owner login

Set `MCP_AUTH_MODE=owner` to use the built-in OAuth authorization server. No
external identity provider, account registration or hosted frontend is needed.
When connecting an AI client, enter your separate owner key on the TYPOS consent
page and approve access to that client's displayed callback address. This grants
read and write access to the entire configured vault.

The server implements authorization code flow with mandatory PKCE S256, dynamic
client registration, resource binding, refresh-token rotation and revocation.
Callbacks must use HTTPS, except `http://localhost`,
`127.0.0.1` and `[::1]` for desktop clients such as Claude Code (RFC 8252). Clients can use `none` or `client_secret_post` token
endpoint authentication. Public registration does not grant access to notes.

Generate a random owner key into a new private file **outside the repository**:

```powershell
npm run mcp:owner-key -- C:\Users\you\typos-mcp-owner.txt
```

The file contains the key. The command prints only the file location and
`MCP_OWNER_PASSWORD_HASH` to put in Railway. Keep the original key in your password
manager; do not paste it into chats, Git or Railway variables. The generated
32-byte key is independent of the storage device key in `STUDYNOTES_LINK`.

Only the scrypt hash is needed to check the owner key. Access and refresh tokens
are stored as hashes in `oauth.json`; registered clients and their credentials
are also persisted. The file is atomically replaced before tokens are returned.
In-flight consent requests and authorization codes are short-lived and kept only
in memory. Restarting during a login requires starting that login again.

Access tokens last one hour. Refresh tokens rotate and expire thirty days after
initial consent. Reusing a previously rotated refresh token revokes its entire
grant. Changing the owner hash or public MCP URL revokes existing grants on the
next start. To reset all clients and grants, stop MCP, remove its `oauth.json`
from the auth volume, and restart; this does not touch notes.

Run **one replica** against the auth directory. The file store and pending login
requests are not designed for multiple workers. Public endpoints have request
limits per client address (IPv6 per `/64`); set `MCP_TRUST_PROXY=1` behind
Railway so the address comes from the proxy's `X-Forwarded-For` instead of the
proxy itself. Consent allows ten attempts per fifteen minutes per address and 300
in total, which only bounds scrypt load: the 32-byte owner key can't be guessed.
Stored clients and grants are capped at 100 each; when client registrations are
full, the oldest client without a grant is dropped, so strangers can't block new
connections. The 100 pending logins are replaced oldest-first. Client
registrations expire after ninety days. Many addresses at once can still slow
logins down, so this is not a multi-tenant hosting service.

## Railway setup

1. Create a separate MCP service from this repository. Set its Dockerfile path to
   `Dockerfile.mcp`, generate an HTTPS domain, and set healthcheck to `/healthz`.
   Leave the existing storage service and its vault volume unchanged.
2. Attach a new persistent volume at `/data` to the MCP service. This volume
   contains authorization state only. Keep one replica.
3. Set these variables on the MCP service:

| Variable | Value |
| --- | --- |
| `MCP_AUTH_MODE` | `owner` |
| `MCP_PUBLIC_URL` | Exact HTTPS endpoint, such as `https://your-mcp.up.railway.app/mcp` |
| `MCP_OWNER_PASSWORD_HASH` | Output of `mcp:owner-key`; never the original key |
| `MCP_AUTH_DATA_DIR` | `/data/auth` |
| `MCP_TRUST_PROXY` | `1`: rate limits use the client address from Railway's proxy |
| `RAILWAY_RUN_UID` | `0` for volume preparation; the entrypoint drops to UID/GID 1000 before starting MCP |
| `STUDYNOTES_LINK` | A dedicated device link for your storage server: `link mcp` (add `--read-only` if the AI should only read) |
| `PORT` | Railway's listening port; defaults to `3000` |

4. Deploy. The image uses Node.js 24 and the npm lockfile. Its startup briefly
   prepares `/data/auth` for UID/GID 1000, drops root privileges, then starts MCP
   as the `node` user. The auth directory is mode `0700`, and files are `0600`.

Enter `STUDYNOTES_LINK` securely in Railway; it contains a device key. Use a
dedicated device link that can be revoked independently: the MCP logs a warning
when it runs on the shared `default` key. The remote MCP talks to
storage through `DavAdapter`, not by mounting the vault. Client OAuth tokens are
never forwarded to the storage service.

`/healthz` checks process health, not storage availability. Confirm the storage
connection with an authenticated tool call. Host and Origin are checked against
`MCP_PUBLIC_URL`. Keep MCP behind Railway HTTPS; ChatGPT connects from its backend.
SIGTERM/SIGINT allows up to ten seconds for shutdown.

## Storage service on Railway

Build the storage service from `Dockerfile.storage`. The image contains only
`server/typos-server.mjs`, without npm packages. Attach the vault volume at
`/data` (the vault itself lives in `/data/vault`, set by `TYPOS_VAULT`) and set
`RAILWAY_RUN_UID=0`: the entrypoint hands the vault to UID/GID 1000 and drops
root before the server starts. It listens on Railway's `PORT` and passes
`--trust-proxy`, so wrong keys are counted per client and not for everyone behind
Railway's proxy. A custom start command replaces those flags; keep
`--trust-proxy` in it.

The server never prints the connection key at startup. Create keys from a
Railway shell: `node server/typos-server.mjs link mcp --dir /data/vault`.

Moving an existing deployment off the shared key:

1. `link mcp` for the remote MCP and `link codex` (or another name) for the local
   plugin and Codex config; put each link where it is used.
2. Check that both work, then `rotate default` and paste the new link into your
   devices, or `revoke default` if every device has its own key.
3. Run `devices` to confirm the list.

The `typos` service with a public domain that answers 404 has no part in this
setup. Remove its domain or the service, so a later deploy from GitHub doesn't
publish anything there by accident.

## Connect ChatGPT

In ChatGPT's custom MCP configuration, use the public `/mcp` URL and OAuth.
The server publishes discovery metadata and supports dynamic registration, so
external-provider client IDs and secrets are not required. On the TYPOS page,
verify that you initiated the connection, enter your owner key, and approve.
Select the connected TYPOS app in a new chat.

Availability and labels depend on the account and workspace. Installing the
local Codex plugin does not automatically create this connection in ChatGPT.
See the official [connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
This setup creates a personal connection, not a public catalog listing.

Verify `list_subjects`, then create, update and read a disposable test note and
send it to the trash. Do not test writes against existing study notes. Local
protocol tests alone do not establish that a real ChatGPT account has connected.

## External OAuth alternative

`MCP_AUTH_MODE=external` is the default for existing installations. Set
`MCP_AUTH_ISSUER`, `MCP_AUTH_JWKS_URL`, and `MCP_AUTH_SUBJECT` in addition to
`MCP_PUBLIC_URL` and `STUDYNOTES_LINK`. The provider must support authorization
code flow, PKCE S256, a registration usable by ChatGPT, and JWT access tokens
signed with RS256 or ES256 and published JWKS.

Tokens must contain `exp`, `iat`, `iss`, `aud`, `sub` and space-separated `scope`.
Audience must be the exact public `/mcp` URL, subject must match the configured
owner, and scope must include `typos`. ID tokens and opaque provider access
tokens are not accepted. This mode does not use the auth volume or owner key.

## Tools and checks

Remote MCP exposes twelve tools. `add_project_file` remains local-only and
appears only when the local MCP is allowed folders with `--files`.
`create_note`, `update_note` and `import_tool` accept inline text; local file
arguments are not exposed. `add_image` accepts only `data:image/...;base64`.
Remote Markdown images are left in place with a warning, without fetching URLs.
Request bodies are limited to 4 MiB, including encoded images.

Run `npm run check`. Tests exercise complete owner login, PKCE, consent binding,
token expiration, rotation, revocation, persistence and key changes. External
OAuth tests use real JWKS and signed tokens. HTTP tests also cover Host/Origin,
metadata, size limits, local-file restrictions and a real storage connection.

Outside Docker, set an absolute writable `MCP_AUTH_DATA_DIR` and run
`npm run mcp:http` with the same variables. The owner-key generator refuses to
overwrite an existing file.
