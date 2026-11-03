# Deployment

TYPOS has three parts. Deploy only the ones you need.

| Part | Deploy from | Persistent data |
| --- | --- | --- |
| Website | `dist/` | None; browser data stays on each device |
| Storage server | `Dockerfile.storage` | `/data/vault` |
| Remote MCP | `Dockerfile.mcp` | `/data/auth` in owner mode |

Use HTTPS for remote access. A website opened over HTTPS cannot connect to HTTP storage.

## Build the website

Use Node.js 24:

```bash
git clone https://github.com/robloxlover44/typos.git
cd typos
npm ci
npm run build
```

Serve `dist/` from an HTTPS static host. Route unknown paths to `index.html` for client-side navigation. Revalidate HTML on each visit; files under `/assets/` can be cached indefinitely.

## Docker and Caddy

Requires Docker Engine and Docker Compose on a Linux server. The configuration is in [`deploy/`](../deploy/).

```bash
sudo mkdir -p /srv/typos
sudo chown "$USER": /srv/typos
cp deploy/.env.example deploy/.env
cd deploy
```

Edit `.env`:

| Variable | Public domains | LAN |
| --- | --- | --- |
| `TYPOS_DATA` | `/srv/typos` | `/srv/typos` |
| `VAULT_NAME` | Your vault name | Your vault name |
| `CADDYFILE` | `Caddyfile` | `Caddyfile.lan` |
| `APP_DOMAIN` | `app.example.com` | Unused |
| `VAULT_DOMAIN` | `vault.example.com` | Unused |
| `MCP_DOMAIN` | `mcp.example.com` | Unused |
| `LAN_IP` | Unused | Server's fixed IP, e.g. `192.168.1.5` |
| `VAULT_URL` | `https://vault.example.com` | `https://192.168.1.5:8443` |
| `MCP_URL` | `https://mcp.example.com` | `https://192.168.1.5:9443` |

`MCP_URL` has no `/mcp` suffix here; Compose adds it.

- Public domains: point all three DNS records at the server. Open ports 80/tcp, 443/tcp and 443/udp.
- LAN: open ports 443, 8443 and 9443. Cloud AI clients cannot reach a private LAN address.

```bash
docker compose up -d --build storage caddy
docker compose logs storage caddy
```

Caddy serves the checkout's `dist/` folder. Keep the checkout in place. Do not publish storage or MCP ports directly: both trust Caddy's forwarded client address. The container entrypoints prepare data permissions as root, then run the servers as UID/GID 1000.

### LAN certificates

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./typos-root.crt
```

Trust this certificate on each device:

| Platform | Install |
| --- | --- |
| Windows | `certutil -user -addstore Root .\typos-root.crt` |
| Debian/Ubuntu | `sudo cp typos-root.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates` |
| Arch Linux | `sudo trust anchor --store typos-root.crt` |
| macOS | Add it to the System keychain and select Always Trust |
| Android | Settings → Security → Install certificate → CA certificate |
| iOS | Install the profile, then enable it in Settings → General → About → Certificate Trust Settings |
| Firefox | Import it under Settings → Certificates if the system store is not used |

For Node.js clients, including local MCP, set `NODE_EXTRA_CA_CERTS` to the certificate's absolute path before starting the client.

### Device keys

Run key commands as `node` so the server can still read its key files:

```bash
docker compose exec -u node storage node server/typos-server.mjs link laptop --dir /data/vault
```

Paste the printed link into TYPOS's storage screen. Use a separate device name for each device or assistant. Add `--read-only` to create a key without write access.

| Command | Purpose |
| --- | --- |
| `link <device>` | Show a link; create a key if the device is new |
| `devices` | List devices and access |
| `rotate <device>` | Replace the key; the old link stops working |
| `revoke <device>` | Disable the key |

Use the same command prefix and `--dir /data/vault` as above. To change access, use `rotate`; include `--read-only` to keep or grant read-only access. Links contain keys. Keep them out of Git, chats and logs.

## Remote MCP

Owner mode provides OAuth login without an external identity provider. Create two separate keys: a storage device key for MCP and an owner key for approving AI clients.

From `deploy/`:

```bash
node ../scripts/mcp-owner-key.mjs /srv/typos/owner-key.txt
docker compose exec -u node storage node server/typos-server.mjs link mcp --dir /data/vault --public-url http://storage:8787
touch /srv/typos/mcp.env
chmod 600 /srv/typos/mcp.env
```

Save the owner key from `owner-key.txt` in a password manager. Put the generator's hash and the storage link into `/srv/typos/mcp.env`:

```dotenv
MCP_OWNER_PASSWORD_HASH=scrypt:…
STUDYNOTES_LINK=typos://storage:8787?…
```

Use the hash value, not the whole JSON output or the owner key. Do not quote the values or add inline comments.

```bash
docker compose --profile mcp up -d --build mcp
curl -f https://mcp.example.com/healthz
```

Run one MCP instance per auth directory. Changing the owner hash or public MCP URL revokes existing OAuth grants on restart.

### Connect an AI client

Use `https://mcp.example.com/mcp` with OAuth. The server supports discovery and dynamic client registration. Check the client name and callback address on the TYPOS consent page, then enter the owner key.

Test `list_subjects`, then create, read, update and trash a temporary note. `/healthz` checks the MCP process, not its storage connection. After updating tools, refresh the client's tool list or reconnect.

For a local MCP process or desktop plugin, use the [plugin guide](../plugins/typos/README.md). The local plugin does not create a remote ChatGPT connection.

## Railway

Create separate services from the repository. Keep their default Docker start commands.

| Setting | Storage service | MCP service |
| --- | --- | --- |
| Dockerfile | `Dockerfile.storage` | `Dockerfile.mcp` |
| Volume mount | `/data` | `/data` |
| Public endpoint | Generated HTTPS domain | Generated HTTPS domain + `/mcp` |
| Healthcheck | `/` | `/healthz` |
| `RAILWAY_RUN_UID` | `0` | `0` |

Railway volumes need root for initial permission setup; the entrypoints then drop privileges. See [Railway volume permissions](https://docs.railway.com/volumes#permissions).

Set these variables on MCP:

```dotenv
MCP_AUTH_MODE=owner
MCP_PUBLIC_URL=https://your-mcp.up.railway.app/mcp
MCP_AUTH_DATA_DIR=/data/auth
MCP_TRUST_PROXY=1
MCP_OWNER_PASSWORD_HASH=scrypt:…
STUDYNOTES_LINK=typos://…
```

Generate the owner key locally with `scripts/mcp-owner-key.mjs`. From a root shell in the storage service, get the link as `node`:

```bash
su node -s /bin/sh -c 'node server/typos-server.mjs link mcp --dir /data/vault --public-url https://your-vault.up.railway.app'
```

Both services use Railway's `PORT`. Keep one MCP replica and its auth volume across deployments. Deploy the website separately as a static site using `dist/`.

## External OAuth

Instead of owner mode, set `MCP_AUTH_MODE=external`, `MCP_AUTH_ISSUER`, `MCP_AUTH_JWKS_URL` and `MCP_AUTH_SUBJECT`. Keep `MCP_PUBLIC_URL` and `STUDYNOTES_LINK`; an auth volume and owner key are not needed.

For Compose, change `mcp.environment.MCP_AUTH_MODE` in `deploy/compose.yml`; it overrides `mcp.env`.

The provider must support authorization code flow, PKCE S256 and client registration suitable for the AI client. Access tokens must be RS256/ES256 JWTs with `exp`, `iat`, `iss`, `aud`, `sub` and space-separated `scope`. Audience must equal `MCP_PUBLIC_URL`, subject must equal `MCP_AUTH_SUBJECT`, and scope must include `typos`. Issuer and JWKS URLs must use HTTPS.

## Updates and backups

From the checkout root:

```bash
npm ci
npm run build
cd deploy
docker compose --profile mcp up -d --build
```

Use `up -d` after changing environment files; `restart` keeps the old environment.

From `deploy/`:

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f` |
| Reload Caddy | `docker compose exec caddy caddy reload --config /etc/typos/Caddyfile --adapter caddyfile` |
| Stop | `docker compose --profile mcp down` |

For LAN, use `Caddyfile.lan` in the reload command.

Back up `/srv/typos/storage`, `/srv/typos/mcp`, `/srv/typos/mcp.env`, `deploy/.env` and Caddy's `caddy_data` volume. Stop services while copying state files. Restore data and permissions before starting them. To migrate an existing vault, copy the whole folder into `/srv/typos/storage/vault`, including `.typos-server/` to preserve device keys.

Never use `docker compose down -v` unless discarding Caddy's certificates and local certificate authority. Treat backups as secrets: server-side files and device keys are not encrypted.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| MCP exits at startup | Required variables, `scrypt:…` hash, writable auth volume, one replica |
| MCP returns 403 | `MCP_PUBLIC_URL` must match the requested HTTPS host, port and `/mcp` path |
| Storage returns 500 after a key command | Restore ownership: `docker compose exec storage chown -R node:node /data/vault/.typos-server`; use `exec -u node` for future key commands |
| Browser rejects the LAN certificate | Install and trust `typos-root.crt`; check `LAN_IP` and `Caddyfile.lan` |
| Storage returns 507 | Free space or raise `--max-vault` / `--max-files`; use `--help` for limits |
| MCP is healthy but tools fail | Check `STUDYNOTES_LINK`, device access and storage availability |
