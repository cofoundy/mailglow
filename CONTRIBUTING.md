# Contributing to mailglow

- **Zero dependencies.** The engine uses the Node ≥ 22 standard library only (see `docs/adr/0001`).
- **Public-only.** Everything must run for anyone with just an agent — no keys, no private infrastructure.
- **Skill shape.** `skills/<name>/SKILL.md` with `name` + `description` frontmatter (name matches dir).
- **A new lint rule** goes in `skills/mailglow/scripts/lib/lint.mjs` with the clients it protects, a
  test in `tests/`, and a regenerated `references/client-compat.md` (`node … rules`; CI diffs it).
  The README badge counts the rules; a test fails until you bump it.

## Add a template

The gallery (`npm run gallery`; canonical base mailglow.cofoundy.dev) is built from `skills/mailglow/examples/`.
A template is one of:

```
skills/mailglow/examples/<name>.html          one email
skills/mailglow/examples/<name>/a.html b.html one email, several variants (shown as A / B / … on its page)
```

The page title comes from `<name>` (`password-reset` → "Password reset"); the subject, sender and
preheader from `<meta name="mail:subject|mail:from|mail:preheader">` in the file. Pick a fictional
brand and sender (`hello@yourbrand.example`), never a real company or person.

It is accepted when:

1. **It lints 0 errors / 0 warnings** — `node skills/mailglow/scripts/mailglow.mjs lint skills/mailglow/examples`.
2. **Images are hosted `https://` URLs only** — no local paths, no `data:` URIs (the linter enforces it).
3. **You looked at it in light, dark and mobile** — `serve skills/mailglow/examples --open`, then
   `d` (scheme) and `m` (mobile); or `shoot` and open the PNGs.
4. **It renders in the gallery** — `npm run gallery`, open `site/index.html` and its page.
5. **The README `templates-N` badge is bumped** (a test compares it with the examples folder).

CI enforces 1, 2, 4 and 5: it lints every example, builds the gallery (with Chrome thumbnails) and checks
every example got a page and a sitemap entry.

## Nothing private

This repo is public and its screenshots are part of it. Before a PR:

```bash
bash scripts/check-private.sh                                         # what CI runs
MAILGLOW_PRIVATE_TERMS="Client A,Jane Doe" bash scripts/check-private.sh   # + OCR of assets/*.png
```

It fails on absolute home paths (`/home/<you>`, `/Users/<you>`), agent scratch paths, e-mail
addresses outside example/fictional domains, and — with `MAILGLOW_PRIVATE_TERMS` set — any of those
terms in text files or visible in a screenshot (tesseract OCR, eng or spa traineddata). Keep the
denylist in your shell, never in the repo.

## Before a PR

```bash
bash scripts/validate-skills.sh && npm test && bash scripts/check-private.sh
```

Agents working on this repo: read [`AGENTS.md`](AGENTS.md).
