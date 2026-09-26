# Changelog

All notable changes to mailglow. Format: [Keep a Changelog](https://keepachangelog.com/), versions: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Round 0 — a target image before any HTML** (SKILL.md): brainstorm full mockups with an image model, pick a
  target, replicate it in layers; keep its shapes by editing the image, never by redrawing them.
- `references/art-direction.md`: the hero band (art + flat colour, text only on the flat colour), textless art
  for every language, live script accents with a system-font fallback chain, images-off and dark variants.
- Contract fields accept `"required": true` to skip the `missing`/`empty` stress shapes.

### Changed
- Design quality gates: the critique scores **beauty against the target** as well as usability; the anti-slop
  list is a filter against generic details, not a style (`anti-slop.md` §What this list is not).

### Fixed
- `contract` printed «undefined» for `deriva` fields and left them out of the per-variant counts.
- `snap --dark` rendered light on mailglow pages (`/raw` defaulted to `scheme=light`).
- `stress-html` raised a false «empty brackets» on list fields (`[]` in the probe value).
- `lint --net` checked `@font-face` URLs as images.
- `/raw/<slug>/<variant>` rejected nested slugs unless the slash was encoded.

## [0.2.0] — 2026-09-24

### Added
- `mailglow gallery [dir] --out site [--base URL] [--no-shots]`: a static landing + template gallery in
  the inbox's visual language — install commands, template cards with desktop + phone thumbnails in
  light and dark, and a page per template with a live preview (desktop/mobile, light/dark, variants),
  **Copy HTML**, download, HTML source and lint status. Per-page `<title>`, description, canonical and
  Open Graph tags; `sitemap.xml`, `robots.txt`, `templates.json`. Canonical base defaults to
  `https://mailglow.cofoundy.dev` (`site/config.json` or `--base` to change it).
- `mailglow init [--agents claude,codex,cursor,gemini,…] [--global] [--force] [--dry-run]`: copies the
  skill into the project's agent skill folders (`.claude/skills`, `.agents/skills`, `.windsurf/skills`…),
  detecting the agents in use by default. Runs as `npx github:cofoundy/mailglow init`.
- `scripts/check-private.sh`: fails on home paths, scratch paths and non-example e-mail addresses in
  tracked text, and OCRs `assets/*.png` against a denylist from `MAILGLOW_PRIVATE_TERMS`.
- CI: a `gallery` job (build with thumbnails, every example has a page and a sitemap entry) and the
  privacy check.
- `AGENTS.md`, CONTRIBUTING "Add a template", README count badges, site screenshots.

## [0.1.0] — 2026-09-23

### Added
- The skill and the zero-dependency engine: `serve` (local inbox with variants, Pick + notes),
  `lint`, `shoot`, `new`, `picks`, `rules`, `snap`; templates with a data contract (`contract`,
  `fetch`, `render`) and the huecos view.
