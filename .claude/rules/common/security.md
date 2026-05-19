# Security (libreflow)

libreflow is **offline, single-user, no auth, no network**. Security focuses on:

1. IPC boundary integrity (JS ↔ Rust)
2. Filesystem path validation
3. Offline guarantee (no exfiltration)
4. Robust parsing of untrusted audio file content

## Mandatory Pre-Commit Checks

- [ ] No external `fetch()`, `XMLHttpRequest`, or `WebSocket` calls (CLAUDE.md §15)
- [ ] Every Tauri command validates input before any FS or system call
- [ ] No path traversal: reject `..` segments, null bytes, control chars
- [ ] No raw `Path::new(user_input)` — always canonicalize and scope-check
- [ ] No `innerHTML` / `eval` / `new Function` with untrusted strings
- [ ] Tag fields (title, artist, album) rendered as text, never as HTML
- [ ] No hardcoded secrets (none expected — keep the discipline)

## IPC Whitelist Discipline

- Every Tauri command appears in `src-tauri/tauri.conf.json` allowlist
- Removing a command = breaking change → bump version
- Adding a command requires: input validation, error mapping, JS-side timeout
- Never expose a command that takes a raw shell string

## Filesystem Hardening

- Reads constrained to user-selected directories (`tauri-plugin-fs` scope)
- Watch folders via `notify` respect the same scope
- Reject paths with: `..`, null bytes, control chars, symlinks pointing outside scope
- Cap path length at platform max (Windows 260 / extended 32k)

## Untrusted Tag Data

- `lofty` parses arbitrary audio files — treat all output as untrusted
- Cap cover-art base64 length to prevent DOM/IDB blow-up
- Reject malformed UTF-8 in title/artist/album
- Always render tag content as text, never HTML

## Plugin Surface Review

`Cargo.toml` declares: `dialog`, `fs`, `notification`, `global-shortcut`, `window-state`, `updater`. Each must be re-reviewed on update:

- `tauri-plugin-updater` — confirm signing key is pinned and rotated
- `tauri-plugin-fs` — scope limited to user-chosen folders only
- `tauri-plugin-global-shortcut` — check for OS-level shortcut collisions

## Secret Management

- No secrets in source (the project has none today)
- If introduced, use OS keychain via a Tauri plugin, never env files
- Audit any new dep with `cargo audit` and `npm audit`

## Security Response Protocol

If a vulnerability is found:

1. STOP — do not commit
2. `cargo audit` and `npm audit` to scope blast radius
3. **security-reviewer** agent for structured analysis
4. Patch + regression test (proptest for Rust input fuzzing is ideal)

## Not Applicable (Documented Skips)

These web-app concerns do **NOT** apply to libreflow — recorded explicitly so reviewers do not waste time auditing absent surface:

- SQL injection (no DB queries; IDB is structured key/value)
- CSRF (no server)
- Authentication / authorization (single-user offline)
- Rate limiting (no HTTP endpoints)
- TLS / cert pinning (no network)
- OAuth / JWT / session management (no identity layer)
- Payment / financial code (no payments)
