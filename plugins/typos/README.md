# TYPOS for Codex

A desktop plugin that reads and edits notes on your TYPOS storage server through
a local MCP process. Each user connects their own vault. No external OAuth
provider or developer account is required. This plugin does not run independently
in ChatGPT on a phone.

## Requirements

- Node.js 22.12 or newer.
- A local checkout of the TYPOS repository with dependencies installed using
  `npm ci`.
- A connection link from your TYPOS storage server.

Keep the checkout in place while using the plugin: the installed plugin launches
the MCP server from that directory.

## Configure your vault

Run the following from the repository root in PowerShell:

```powershell
$typosLink = Read-Host 'TYPOS connection link' -AsSecureString
[System.Net.NetworkCredential]::new('', $typosLink).Password | node plugins/typos/setup.mjs (Get-Location).Path
Remove-Variable typosLink
```

The link is entered without echoing and is not included in command history.
On macOS or Linux, use Bash:

```bash
read -rsp 'TYPOS connection link: ' typos_link
printf '%s' "$typos_link" | node plugins/typos/setup.mjs "$PWD"
unset typos_link
```

Settings are stored in `~/.typos/mcp.json`, outside the repository and the plugin
cache. This file contains your storage key. Do not publish or share it. On Windows,
access follows your profile's filesystem permissions; on POSIX, the file is
created with mode `0600`.

Use the storage server's `link mcp` command to create a dedicated device key that
can be revoked without disconnecting your other devices.

## Install

Create a ZIP containing the contents of this plugin directory, including the
`.codex-plugin/` directory and `.mcp.json` file. `plugin.json` must be at the archive
root, not inside another folder. Never include `~/.typos/mcp.json` in the archive.

In Codex, open **Plugins → Add → Upload plugin archive**, select the ZIP, and
complete installation. Start a new chat and ask TYPOS to list your subjects.

### Repository marketplace

The repository also includes `.agents/plugins/marketplace.json`. Clients that
discover repository marketplaces can show the **TYPOS** source in the plugin
directory after a restart.

Recent Codex CLI versions can register the repository explicitly:

```bash
codex plugin marketplace add /absolute/path/to/typos
```

Older CLI versions may not support the `plugin` command. Use archive installation
if the marketplace is not available in your client.

### Avoid duplicate tools

If you already configured a standalone `typos` MCP server in
`~/.codex/config.toml`, verify the plugin first, then set `enabled = false` in the
`[mcp_servers.typos]` section. This prevents two copies of the same tools from
appearing in new chats.

## Verify and update

Ask TYPOS to list your subjects. Use a disposable note to test writing. If the
storage server is unavailable, tools report a connection error; installing the
plugin does not make the server available offline.

After updating the TYPOS checkout, run `npm ci` and restart Codex. Changes to the
plugin package also require updating the installed copy through the plugin
directory or uploading a new archive.
