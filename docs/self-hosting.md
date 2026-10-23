# Self-hosting TYPOS

Run the whole stack on one Linux server with Docker: the storage server, the
remote MCP for AI clients, and the website, all behind Caddy for HTTPS. The
files are in [`deploy/`](../deploy). For Railway, see
[Remote MCP on Railway](mcp-railway.md).

| Part | Container | Reached at |
| --- | --- | --- |
| Website (the PWA from `dist/`) | `caddy` | `https://app.example.com` |
| Storage server (`server/typos-server.mjs`) | `storage` | `https://vault.example.com` |
| Remote MCP with OAuth (optional) | `mcp` | `https://mcp.example.com/mcp` |

Only Caddy publishes ports. Storage and MCP are reachable only through Caddy and,
for MCP, through Docker's internal network (`http://storage:8787`). Both drop
root and run as UID 1000.

There are two modes:

- **Public domains.** Caddy gets certificates from Let's Encrypt. Required for
  ChatGPT and other cloud AI clients, which connect from their own servers.
- **Local network without domains.** HTTPS on the server's IP, with
  certificates from Caddy's own local authority. Every device has to trust that
  authority once. Cloud AI clients can't reach this setup; use the local MCP or
  the [Codex plugin](../plugins/typos/README.md) instead.

## Requirements

- Debian or another Linux with Docker Engine and the Compose plugin.
- Git and Node.js 20.19+ or 22.12+ to build the website (or build it in a
  container, see step 2).
- Public domains: three DNS records (`app`, `vault`, `mcp`) pointing to the
  server, ports 80/tcp, 443/tcp and 443/udp open.
- Local network: a fixed IP for the server (a DHCP reservation on the router).
  Ports 443, 8443 and 9443 open on the server.

## 1. Get the code

```bash
sudo git clone <repository> /opt/typos
sudo chown -R "$USER": /opt/typos
```

## 2. Build the website

```bash
cd /opt/typos
npm ci && npm run build
```

If the server's Node.js is older, build in a container instead:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v /opt/typos:/app -w /app \
  node:24-bookworm-slim sh -c 'npm ci && npm run build'
```

Caddy serves `/opt/typos/dist` directly, so rebuilding is enough to update the
website.

## 3. Configure

Data lives outside the repository, so it never ends up in a Docker build context
or in Git:

```bash
sudo mkdir -p /srv/typos && sudo chown "$USER": /srv/typos
cd /opt/typos/deploy
cp .env.example .env
```

Edit `deploy/.env` (it is ignored by Git):

| Variable | Public domains | Local network |
| --- | --- | --- |
| `TYPOS_DATA` | `/srv/typos` | `/srv/typos` |
| `VAULT_NAME` | Name shown in the app | Name shown in the app |
| `CADDYFILE` | `Caddyfile` | `Caddyfile.lan` |
| `APP_DOMAIN`, `VAULT_DOMAIN`, `MCP_DOMAIN` | Your three domains | Not used |
| `LAN_IP` | Not used | The server's IP, for example `192.168.1.5` |
| `VAULT_URL` | `https://vault.example.com` | `https://192.168.1.5:8443` |
| `MCP_URL` | `https://mcp.example.com` | `https://192.168.1.5:9443` |

`VAULT_URL` goes into the connection links that `link` prints, and `MCP_URL` is
the address AI clients use. Both must match how devices reach Caddy.

To move an existing vault, copy it before the first start, including
`.typos-server/` to keep its keys:

```bash
mkdir -p /srv/typos/storage
rsync -a /path/to/old-vault/ /srv/typos/storage/vault/
```

## 4. Start storage and Caddy

```bash
cd /opt/typos/deploy
docker compose up -d --build storage caddy
docker compose logs storage caddy
```

Storage should print `TYPOS storage «…» запущен`. Caddy should log
`certificate obtained successfully` for each address. The server never prints a
key at startup.

## 5. Trust the local certificate (local network only)

Copy Caddy's root certificate out of the container:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./typos-root.crt
```

Install `typos-root.crt` on every device that opens TYPOS:

| Device | How |
| --- | --- |
| Windows | `certutil -user -addstore Root .\typos-root.crt` (current user), or as administrator without `-user` (all users). Edge, Chrome and the desktop app use this store |
| Debian or Ubuntu | `sudo cp typos-root.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates` |
| Arch Linux | `sudo trust anchor --store typos-root.crt` (Firefox and Chromium use this store too) |
| macOS | Open the file in Keychain Access, add it to the System keychain, set it to Always Trust |
| Firefox | Settings → Certificates → Import, or `security.enterprise_roots.enabled` = `true` on Windows |
| Android | Settings → Security → Install certificate → CA certificate |
| iPhone | Install the profile, then Settings → General → About → Certificate Trust Settings → turn it on |

Node.js ignores the system store. For the local MCP and the Codex plugin, set
`NODE_EXTRA_CA_CERTS` to the file's path (a user environment variable on Windows).

To check on Windows: `certutil -user -store Root "Caddy Local Authority - 2026 ECC Root"`
(use the year from the certificate's name).

## 6. Create device keys

Run key commands as the `node` user. As root they rewrite `server.json` owned by
root, and the server can no longer read its keys.

```bash
cd /opt/typos/deploy
docker compose exec -u node storage node server/typos-server.mjs link phone --dir /data/vault
docker compose exec -u node storage node server/typos-server.mjs link laptop --dir /data/vault
docker compose exec -u node storage node server/typos-server.mjs devices --dir /data/vault
```

One key per device lets you disconnect one without touching the others
(`revoke <device>`). Add `--read-only` for anything that only needs to read. The
links contain the keys: don't paste them into chats, issues or logs.

## 7. Start the MCP (optional)

Generate the owner key you will type on the OAuth page. The script needs no
dependencies and refuses to overwrite an existing file:

```bash
node /opt/typos/scripts/mcp-owner-key.mjs /root/typos-mcp-owner.txt
```

Keep the key from that file in your password manager. Create a key for the MCP
with the internal address, so its traffic never leaves the server:

```bash
docker compose exec -u node storage node server/typos-server.mjs link mcp \
  --dir /data/vault --public-url http://storage:8787
```

Create `/srv/typos/mcp.env` with `chmod 600`:

```
MCP_OWNER_PASSWORD_HASH=scrypt:…
STUDYNOTES_LINK=typos://storage:8787?…
```

Use only the `scrypt:…` value from the generator's JSON, not the key and not the
whole JSON. No quotes, no spaces, no comments on these lines. Then:

```bash
docker compose --profile mcp up -d --build mcp
docker compose logs mcp
```

The log should say `MCP HTTP запущен на порту 3000`, without a warning about the
`default` key.

## 8. Connect

- **Website or desktop app:** open the app, go to «Хранилище» → «Сервер
  хранения», paste the device's link.
- **ChatGPT** (public domains only): add a custom MCP connector with
  `https://mcp.example.com/mcp` and OAuth, then enter the owner key on the TYPOS
  page. See [Connect ChatGPT](mcp-railway.md#connect-chatgpt).
- **Claude Code:** `claude mcp add --transport http --scope user typos https://mcp.example.com/mcp`,
  then run `/mcp` in a session, choose `typos` → Authenticate, and enter the
  owner key on the TYPOS page that opens. On the local network, start Claude
  Code with `NODE_EXTRA_CA_CERTS` pointing to the root certificate (step 5).
- **Codex plugin or local MCP on your computer:** create a key with
  `link codex` and follow the [plugin guide](../plugins/typos/README.md).

## Everyday operations

All commands run from `/opt/typos/deploy`. Add `--profile mcp` to commands that
should include the MCP.

| Task | Command |
| --- | --- |
| Update | `git -C /opt/typos pull && (cd /opt/typos && npm ci && npm run build) && docker compose --profile mcp up -d --build` |
| Apply a Caddyfile change | `docker compose exec caddy caddy reload --config /etc/typos/Caddyfile --adapter caddyfile` (or `Caddyfile.lan`) |
| Apply a `.env` or `mcp.env` change | `docker compose --profile mcp up -d` (`restart` keeps the old environment) |
| Newer Caddy | `docker compose pull caddy && docker compose up -d caddy` |
| Logs | `docker compose logs -f storage` (or `caddy`, `mcp`) |
| Stop | `docker compose --profile mcp down` |

Never add `-v` to `down`: it deletes Caddy's volume, including the local
certificate authority, and every device would have to trust a new one.

**Backups:** `/srv/typos/storage` (notes and the keys in `.typos-server/`) and
`/srv/typos/mcp` (OAuth clients and grants). Treat both as secrets.

## Moving from the local network to domains

1. Point the DNS records to the server and open ports 80 and 443 to the internet.
2. In `deploy/.env`, switch to the public-domain block.
3. `docker compose --profile mcp up -d`.
4. Run `link <device>` again for each device. The key stays the same, only the
   address in the link changes. Paste the new link into each device.

Changing `MCP_URL` revokes existing OAuth grants. Connect AI clients again.

## Troubleshooting

**`docker compose up` times out pulling images.** Check Docker Hub:
`curl -4 -sSI https://registry-1.docker.io/v2/` should answer `401`. If it works
but pulls still stall, add a mirror and calmer download settings to
`/etc/docker/daemon.json`, then `sudo systemctl restart docker`:

```json
{
  "registry-mirrors": ["https://mirror.gcr.io"],
  "max-concurrent-downloads": 1,
  "max-download-attempts": 10
}
```

**`ERR_SSL_PROTOCOL_ERROR` on the IP address.** Browsers don't send the site
name (SNI) for IP addresses, and inside Docker Caddy sees the container's
address, not the server's. `Caddyfile.lan` handles this with `default_sni`; make
sure `LAN_IP` is set and Caddy uses `Caddyfile.lan`.

**The browser warns about the certificate (local network).** The device doesn't
trust Caddy's root yet (step 5). On Windows, the import wizard's automatic store
choice doesn't work; use `certutil` or choose «Доверенные корневые центры
сертификации» yourself.

**MCP exits with «Задай MCP_OWNER_PASSWORD_HASH».** The value in `mcp.env` isn't
exactly `scrypt:` + 22 characters + `:` + 43 characters. Common causes: the whole
JSON or the key pasted instead of the hash, a comment at the end of the line,
Windows line endings (`sed -i 's/\r$//' /srv/typos/mcp.env`), or `restart`
instead of `up -d` after editing.

**MCP exits with «Укажи хранилище».** `STUDYNOTES_LINK` is empty (step 7).

**MCP answers 403 «Недопустимый Host или Origin».** `MCP_URL` doesn't match the
address clients use, including the port.

**Storage answers 500 after `link`.** The command ran as root and `server.json`
is now owned by root. Fix it with
`docker compose exec storage chown -R node:node /data/vault/.typos-server` and
always use `-u node` afterwards.

## Security notes

- Never publish the storage or MCP ports (`ports:` in `compose.yml`). Storage
  runs with `--trust-proxy`: it takes the client address from Caddy's
  `X-Forwarded-For`, which a direct client could fake to dodge the wrong-key
  lockout.
- Connection links are keys. Rotate a key that may have leaked:
  `rotate <device>`.
- Give the MCP its own key (`link mcp`), never `default`.
- The local root certificate can vouch for any site on the devices that trust
  it. Keep the Caddy volume private and don't share the certificate beyond your
  own devices.
- The server stores notes and keys unencrypted. Anyone with access to
  `/srv/typos` or the host can read them.
