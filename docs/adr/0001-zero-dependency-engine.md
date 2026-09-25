# 0001 — The engine is one zero-dependency Node script

**Status:** accepted · 2026-09-23

## Context
The skill must run for anyone who installs it with `npx skills add`, inside whatever agent they use, with
no build step. Skills are copied as a folder, so the engine has to live inside `skills/mailglow/`.

## Decision
- Node ≥ 22 standard library only: `http` for the inbox, `fs.watch` + SSE for live reload, the global
  `WebSocket` to drive headless Chrome over the DevTools Protocol for screenshots (no Puppeteer/Playwright).
- The linter is static and regex-based with ~35 named rules; each rule states the clients it protects.
  It is intentionally not a full caniemail engine — it catches what breaks real sends and stays readable.
- Variants are files in a folder; the user's choice is `picks.json`. The agent/user contract is the file
  system, not an API.

## Consequences
- `shoot` needs a local Chrome/Chromium/Edge (`CHROME_PATH` overrides discovery).
- "Forced dark" is an approximation (CSS inversion), labelled as such in the UI.
- Deeper per-property support data (caniemail) can be added later as an optional `--deep` pass.
