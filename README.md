<p align="center">
  <img src="docs/cover.jpg" alt="TYPOS" width="100%">
</p>

# TYPOS

We couldn't find cool, simple and good looking Apple-like notes for windows.
So we made TYPOS - offline study notes for Windows and the browser. Notes are Markdown files, organized by subject. Create folders, render your files(HTML, pics, pptx, pdf) and pin important things. 

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/note-dark.webp">
  <img alt="A note with math formulas" src="docs/screenshots/note-light.webp">
</picture>

## Features

- Markdown editor with LaTeX formulas, tables and images.
- Formula cards with a review mode.
- Boards with text, formulas, images and arrows. Saved as JSON Canvas files.
- PDFs, presentations, documents and sandboxed HTML tools.
- Search across subjects.
- MCP connection to work with AI agents.
- Offline editing and optional sync through a storage server.
- Trash with 30-day recovery.

## Quick start

Requires Node.js 22.12 or newer. Folder access in the browser requires Chrome or Edge.

```bash
git clone https://github.com/robloxlover44/typos.git
cd typos
npm ci
npm run dev
```

Open <http://localhost:5173>. Choose a notes folder or use browser storage.

For the desktop app, install [Rust and the Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then run `npm run desktop`.

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the website into `dist/` |
| `npm run desktop:build` | Build desktop installers |
| `npm run check` | Type-check, lint, check formatting and run tests |
| `npm run format` | Format source files |
| `npm run test:rust` | Test the desktop backend |

## Storage server

Run these in separate terminals:

```bash
node server/typos-server.mjs --dir ./vault
```

```bash
node server/typos-server.mjs link laptop --dir ./vault
```

Paste the link into TYPOS's storage screen. The link contains a key; keep it private.

For Docker, HTTPS, LAN, Railway, remote MCP and backups, see [Deployment](docs/deployment.md).

## AI integration

The MCP server lets an assistant read and edit notes, formula cards, projects and boards.

```bash
npm run mcp -- --vault "/path/to/notes"
```

For a storage server, use `--link "typos://…"` instead of `--vault`. Local file access requires an explicit `--files` folder.

- [Desktop plugin setup](plugins/typos/README.md)
- [Remote MCP and OAuth](docs/deployment.md#remote-mcp)
- [Contributor guide](AGENTS.md)

## License

[MIT](LICENSE)
