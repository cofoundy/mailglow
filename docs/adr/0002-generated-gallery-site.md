# 0002 — The gallery is a generated static site, built by the engine

**Status:** accepted · 2026-09-24

## Context

Skill repos that spread (ui-ux-pro-max-skill, impeccable) pair the skill with a landing page, a
gallery of results and screenshots in the README. mailglow needs the same without breaking
ADR 0001 (zero dependencies).

## Decision

- `mailglow gallery` renders the site from an emails folder with template literals: no framework, no
  bundler, no markdown pipeline. Thumbnails reuse the `shoot` pipeline (Chrome over CDP).
- Links inside the site are relative (works from `file://` and any host); only canonical, `og:url` and
  the sitemap are absolute, from `--base` / `site/config.json`.
- `site/` is build output and is gitignored except `site/config.json`. CI builds it and uploads it as an
  artifact; hosting is a deploy concern, not a repo one.
- Anyone can point it at their own folder (`gallery ./emails --base …`) to get a shareable catalog of
  what their product sends.

## Consequences

- The site stays in lockstep with the engine (lint counts, renders) because it *is* the engine.
- No image resizing without a dependency: thumbnails are the 2× `shoot` PNGs (~150–350 KB each), loaded
  lazily after the first six cards.
