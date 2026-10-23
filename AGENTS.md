# TYPOS: guide for contributors and coding agents

TYPOS is a study-notes app: React 19 + TypeScript PWA, a Tauri 2 desktop shell, a zero-dependency Node storage server, and an MCP server. Notes are plain Markdown files in a "vault" folder. See README.md for what the app does; this file is about how the code is written.

## Before you finish

Run `npm run check` (tsc, oxlint, prettier --check, vitest). It must pass.
If you touched `src-tauri/`, also run `npm run test:rust` and `cargo fmt --check` in `src-tauri/`. The Tauri crate needs the WebKitGTK system libraries on Linux; if they are missing, say so instead of claiming it compiles.
Lint warnings that exist in files you didn't touch are known; don't add new ones.

## Version control

The repo is managed with **jujutsu** (colocated with git), so git shows a detached HEAD. That is normal.
**Never run `jj` commands** (they prompt for a passcode and hang the session), and don't commit, branch or switch with git either. Read-only git (`git show`, `git diff`, `git log`) is fine. The user commits.

## Layout

```
src/app/        shell, routes, layout, theme, PWA
src/editor/     Tiptap editor, math, Markdown import/export
src/features/   pins (formula cards), tools (sandboxed HTML), search, subjects
src/pages/      route pages
src/storage/    VaultAdapter implementations, storage server client, sync engine
src/vault/      file format (format.ts), file operations (repo.ts), app state (store.ts)
server/         typos-server.mjs (storage server, one file, JSDoc-typed JS) + integration tests
src-tauri/      desktop backend (Rust): window, folder picker, file access
mcp/            MCP server; reuses src/vault through NodeFsAdapter (--vault) or DavAdapter (--link)
deploy/         Docker Compose + Caddy for self-hosting (docs/self-hosting.md)
```

All file access goes through `VaultAdapter` (`src/storage/VaultAdapter.ts`). UI and `repo.ts` never know which storage is open. Kinds: `browser` (IndexedDB), `folder` (File System Access in the browser, `TauriAdapter` on desktop), `remote` (`SyncedAdapter`: local IndexedDB copy + `SyncEngine` + `RemoteAdapter` transport; `DavAdapter` talks to the server directly with no local copy, for the MCP server and tests), `memory` (tests).
Code in `src/storage/` and `src/vault/` also runs in Node (MCP server, tests): no `DOMParser`, `window` or `document` there, except in clearly browser-only adapters.

## Language

- UI text, error messages shown to users, code comments, JSDoc and test names: **Russian**. Use «ёлочки» for quotes and `—` for dashes in Russian text.
- README.md and this file: English.
- Identifiers: English.

## Formatting and imports

- Prettier formats everything except Rust and Markdown (`.prettierrc.json`): no semicolons, single quotes, trailing commas, 140 columns. Run `npm run format`; don't hand-format.
- Import order is enforced by the Prettier plugin: Node built-ins, packages, `@/…`, relative. No blank lines between groups. Side-effect imports (`import 'fake-indexeddb/auto'`) stay first.
- Import app code through `@/`; use relative imports only inside the same folder (`./x`, `../store`).
- Rust: `cargo fmt` with `src-tauri/rustfmt.toml` (2 spaces, 140 columns).

## TypeScript

- `strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` (no enums, no namespaces, no constructor parameter properties: declare fields and assign them in the constructor).
- Use `import type` / inline `type` for type-only imports (`verbatimModuleSyntax`).
- No `any`. Narrow `unknown` errors with `e instanceof Error ? e.message : String(e)`.
- `server/typos-server.mjs` stays dependency-free JavaScript with JSDoc types; it is type-checked by `server/tsconfig.json` (`checkJs`).
- Files: React components `PascalCase.tsx`, everything else `camelCase.ts`. Hooks start with `use`.

## Comments

Comment *why*, not what: one short Russian line above the non-obvious decision (a race, a browser quirk, a security reason). Exported functions and interfaces get a one-line JSDoc when the name doesn't say everything. Don't leave commented-out code or comments that narrate the change.

## React and state

- Global state lives in zustand stores (`useVault`, `useUi`, `useConnection`, `useSync`). Select one field per hook call: `useVault((s) => s.adapter)`, not the whole store.
- Side effects that outlive a component (sync, connection monitoring) belong to the storage layer with a `start()`/`stop()` pair; components only call them from an effect (see `useServerSync` in `AppShell.tsx`).
- Don't call `setState` synchronously inside `useEffect` (oxlint warns).
- Shared UI copy that depends on storage goes through helpers (`storageLabel`, `MIXED_CONTENT_HINT`), not duplicated strings.

## Errors

- User-facing errors are Russian sentences that say what to do next ("Проверь, что он запущен…").
- Network errors from the storage server are `RemoteError` (with `status` when the server answered). The sync engine treats an error without `status` as "no connection".
- Async click handlers wrap work in `try/catch/finally`: show `toast.error(...)` and always reset busy state in `finally`.

## Security invariants (don't break these)

- **Vault paths** are relative, `/`-separated, with no `..`, `.`, `\`, `:` segments. Every adapter rejects anything else. Disk adapters also check the real path after symlinks and junctions (nearest existing ancestor; a dangling link is refused): `resolve` in the storage server, `safe` in `NodeFsAdapter`, `paths::confine` in Rust.
- **Storage server**: never serve `.typos-server/` (key storage) under any spelling (`isStateDir`) or through a symlink (`insideState`). The MCP `NodeFsAdapter` (`isServerStateDir`) and Rust (`paths::is_state_dir`) have the same check; keep all three in sync; never follow links outside the vault (`insideRoot`); writes are atomic (`writeAtomic`) and serialized (`exclusive`); conditional writes use ETags. Validate every CLI number with `numberFlag`. Never print a key on `serve`: only `link` and `rotate` show links. Read-only devices (`access: 'read'`) get 403 on every write method. Keep the vault quotas and stream limit. The container entrypoint (`server/container.mjs`) must drop root before calling `main`.
- **MCP local files**: the AI reads files on this computer only through `LocalFiles` (`mcp/localFiles.ts`): folders allowed with `--files`, real path inside them, no hidden segments. Without folders, file arguments are not exposed at all. Remote (HTTP) MCP never reads files. Images by URL go through `fetchPublic` (`mcp/fetchPublic.ts`): public addresses only, checked in the DNS lookup of every hop, with a streaming size limit. Never use plain `fetch` for URLs that come from the AI.
- **OAuth (remote MCP)**: rate limits are per client address (`clientKey`), never one shared key, so strangers can't lock the owner out. A full table evicts unused clients and the oldest pending login instead of refusing everyone.
- **Desktop**: Rust file commands work only inside folders in the `Granted` set, which only the native folder dialog (`vault_pick`) or the saved choice (`vault_saved`) can add to. Never add a command that takes an arbitrary path from JS without `Granted::check`. Keep the window's capabilities minimal (`core:default`).
- **HTML tools** run in a sandboxed iframe without `allow-same-origin` plus their own CSP (`src/features/tools/sandbox.ts`). Don't loosen either. `withCsp` puts the CSP meta first, after the doctype only. Never search the tool's HTML for `<head>` (comments and strings fool a regex).
- **Desktop CSP** (`tauri.conf.json`): tool iframes are `srcdoc` and inherit the window's policy, so `script-src` keeps `'unsafe-inline'`/`'unsafe-eval'`/CDNs for them, and Tauri's nonce injection is off for `script-src`/`style-src` (a nonce would disable `'unsafe-inline'`). Keep `object-src 'none'`, `base-uri`, `form-action`, and the frame, worker and image sources narrow.
- Connection links contain the device key. Never log them, and never put them in URLs that leave the device.

## Tests

- Vitest, files `*.test.ts` next to the code (`src/**`, `mcp/**`, `server/**`). Test names are Russian sentences that describe behaviour.
- Storage-server and sync tests in `server/` start a real server on port 0 in a temp dir. Use `DavAdapter` (`src/storage/davAdapter.ts`) to read and write the server directly, as "another device" or a file manager would.
- Fix the code, not the test, unless the test is wrong. Every bug fix gets a test that would have caught it.

## Dependencies

Add a dependency only when it removes real code. The storage server must stay dependency-free. Keep JS `@tauri-apps/*` packages and Rust `tauri*` crates on matching minor versions. In `Cargo.toml`, write the full version that `Cargo.lock` resolves (`"2.8.3"`, not `"2"`).
