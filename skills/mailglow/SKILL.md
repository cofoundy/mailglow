---
name: mailglow
description: Design, iterate and audit beautiful, responsive HTML emails with a local mini inbox. Use when the user wants to create an email template, redesign or improve transactional/notification/marketing emails, see how their app's emails look (Gmail, Outlook, Apple Mail, mobile, dark mode), compare design variants and pick one, lint an email for client compatibility, or screenshot every email a product sends. Triggers - "design an email", "email template", "make our emails look better", "preview emails", "how do our emails look", "email dark mode", "screenshot all emails", "vibe-code an email".
---

# mailglow

Design emails the way you'd design a screen: see them in an inbox, flip between variants, pick one,
refine — and never ship something you haven't looked at in light, dark and mobile.

The engine is one zero-dependency Node script (Node ≥ 22; `shoot` also needs Chrome/Chromium/Edge):

```bash
VE="node <this-skill-dir>/scripts/mailglow.mjs"   # resolve <this-skill-dir> to the folder holding this SKILL.md
$VE serve emails --open     # mini inbox: list + opened message, live reload, variants, Pick + notes
$VE lint  emails            # client compatibility, exit 1 on any error  (--net checks hosted images answer)
$VE shoot emails            # PNG of every email × desktop/mobile × light/dark (+ the inbox view) + index.html
$VE new   welcome emails --variants 3   # emails/welcome/{a,b,c}.html from the bulletproof starter
$VE picks emails            # what the user picked in the inbox, and their notes per variant
$VE contract emails/welcome # after design: each {{field}} → the endpoint it comes from; what's missing
$VE fetch emails/welcome --base https://api… --name real-1 --param id=…   # a data case from the real API
$VE stress emails/welcome --from real-1   # cases/stress-*.json (empty, emoji names, 600-char text…) + check every variant
```

A folder of emails is the whole interface: `emails/welcome.html` is one message;
`emails/welcome/{a,b,c}.html` is one message with three variants. Inbox metadata comes from
`emails/manifest.json` or `<meta name="mail:subject|mail:from|mail:preheader">` in each file.

## The two rules

**Nothing gets redesigned before the user has seen the current state in the inbox.** Capture or write
first, `serve`, let them look. Then iterate. A redesign built on emails nobody opened is a guess.

**No variant is drawn before the real data has been looked at.** One tidy example ("Ana Torres", one
clear message) designs an email for that example; production sends emoji-only names, "WhatsApp User"
placeholders, 600-char notes, "ok" as the last message and no phone. Step R below is required, and a
variant is judged by its worst case, not its best.

## Pick the mode

| The user has… | Mode |
|---|---|
| nothing yet ("design a welcome email") | **A. New** |
| emails in a codebase ("how do our emails look?", "make them better") | **B. Capture**, then **C. Iterate** |
| one email they want improved | **C. Iterate** |

### Step 0 — brand, once

Look for `EMAIL-BRAND.md` at the project root. If missing, write it with the user (ask only what the repo
can't tell you): product name and sender (`Name <address>`), **hosted** logo URL (https — never a repo
path), light + dark palette (background, card, ink, muted, accent, accent-ink), font stack with a system
fallback, voice (3 adjectives + 3 words it never uses), footer/legal line, the product's app URL. Every
email reads it. Template: `references/email-brand-template.md`.

### R. Real data first (required — before any variant, in A and C)

Method and a worked catalogue: `references/real-data-first.md`.

1. **Capture 10–40 real instances** of what the email will carry (the last N times it would have fired:
   DB, API, logs — read-only, staging if it has traffic, never committed).
2. **Catalogue the shapes with counts**, per field: clean / ALL CAPS / emoji-only / placeholder / fancy
   Unicode names; missing fields; length (median, max); list sizes; media-only items; last message
   actionable or not. Counts, not adjectives — show the table to the user.
3. **Derive the rules** the design may assume: name normalization + fallback, how many context items
   (filtered, capped), length caps in code, the designed "not there" state of every optional field.
4. Save 3–5 real instances spanning the shapes as `cases/*.json`; after the contract exists (D), run
   `$VE stress emails/<slug> --from <real-case>` and add the catalogue's odd values as `"stress": [...]`
   on their fields. Walk the cases with `[` `]` in the inbox; stress cases come after the real ones.

If the user can't give access to real data, say what the design is blind to and ask for 10 examples
pasted by hand — don't substitute invented ones silently.

### A. New email

0. **Step R first.** The catalogue decides what the variants must survive.
1. **State the question in one line** — what the email must make the reader do, and what they feel
   when it lands (e.g. "a restaurant owner on a phone between orders must open the waiting lead in one tap").
2. `$VE new <slug> emails --variants 3`, then rewrite each variant as a **structurally different** answer
   (different hierarchy, layout or primary affordance — not a recolor). If two come out alike, redo one
   with an explicit "do not use X". Use `references/design-principles.md` and `references/components.md`.
3. Fill real copy and **a real case from step R** — the median one, not the prettiest. Lorem ipsum and
   hand-picked tidy names hide every length and emptiness problem.
4. `$VE lint emails` → zero errors. Then `serve` and hand over the URL (see **Hand-off**).

### B. Capture a product's existing emails

Emails built in code (f-strings, Jinja, React Email, MJML, a mailer class…) are captured **by calling
the real builders**, never by copying HTML by hand — a copy drifts the moment someone edits the code.
Write a small dump script next to the code that imports the builders, feeds them realistic fixture data,
intercepts the send seam, and writes `<slug>.html` + `manifest.json` (subject, from, preheader, trigger,
`source: file:line`). Recipe and a worked example: `references/capture-existing.md`.

Then: `$VE lint <dir>` → `$VE shoot <dir>` → **open the screenshots yourself** → `serve` for the user.
Report per email: what it is, when it fires, its lint errors, and what looks wrong in dark/mobile.

### Design quality gates (every round, before the user sees anything)

- **Directions are worlds, not paints.** Round-1 variants must differ in STRUCTURE (information order, the one
  gesture that owns the email, what is omitted). Anchor each on a concrete artefact from the reader's world
  (a kitchen ticket, the chat itself, a bank alert). Judge a direction as a SYSTEM: the same direction applied to
  2–3 emails of different urgency (alert, digest, transactional).
- **The headline is the ask or the outcome**, in the customer's/reader's words — never the system event.
- **Anti-slop pass**: strip every tell in `references/anti-slop.md` (eyebrows, "·" chains, "→", emoji icons,
  pills, key/value rows, card-in-card, side-stripes, identical rows).
- **Fresh critique before presenting**: a reviewer that did not design it scores the round (with the
  Impeccable plugin: `/impeccable critique`; otherwise a fresh subagent with the anti-slop list + heuristics).
  Fix P0/P1 first. Show the score with the work.
- **Huecos in every round**: `$VE contract <slug>` per variant — existe / **deriva** (data exists, needs a rule or
  endpoint) / falta (data doesn't exist) / sin origen — and say what each design would cost to build.

### C. Iterate (the loop)

1. Put the current version in as variant `a` (`emails/<slug>/a.html`) so every round compares against it.
   Step R done? Its catalogue is the brief the challengers answer.
2. Write 2–3 challengers (`b`, `c`…). Round 1 = structurally different; later rounds = targeted.
3. `lint` → zero errors on every variant. `serve`; the user flips with ← →, presses **Pick**, and types
   notes per variant. Those land in `emails/picks.json`.
4. Read `$VE picks emails`. The notes are the brief for the next round — "header of b with the table of c"
   is the actual design. Apply at most 3 changes per round so you know what helped.
5. When the user is happy: promote the winner to `emails/<slug>.html`, move the losers to
   `emails/.archive/<slug>/` (hidden from the inbox, kept as the record), `shoot` for evidence.
6. **Data contract — required before porting** (step D below).
7. **Port to production** in the codebase's own format, then re-run the capture script and lint/shoot the
   *real* output. The loop is closed when the builder's output matches what was picked.

### D. Data contract (the requirement after design)

Design first, freely — with realistic data typed in. Once a direction is picked (or when comparing
variants whose cost matters), the email stops being a picture and becomes a **template + contract**:

1. Replace every data value with a field: `{{contact.name}}`, `{{#messages}}…{{/messages}}`, links
   `https://app…/inbox?c={{conversation.id}}`, subject/preheader meta too. Syntax: `references/data-contract.md`.
2. Write `contract.json` next to the variants: every field → the **real endpoint** and JSON path it comes
   from (read the product's routes and schemas — cite them), `status: "existe"`; a field nothing provides
   today → `status: "falta"` with the endpoint that should be built, a note and a `sample`.
3. Fill `cases/*.json` from real data: `$VE fetch emails/<slug> --base <api> --name <case> --param id=…
   --header "Authorization: Bearer …"` calls the endpoints that exist and falls back to samples for the rest.
   Read-only credentials, staging first; real customer data never gets committed.
4. `$VE contract emails/<slug>` prints fields × variants × source and **the endpoints to build**.
   In the inbox, `h` toggles **huecos**: every field outlined green (exists), amber (endpoint missing),
   red (no source) — hover shows the endpoint. This is how a variant's real cost is compared.
5. **Stress it**: `$VE stress emails/<slug> --from <real-case>` writes `cases/stress-*.json` from the
   contract's field kinds (declare `"kind"` — name|text|longtext|phone|url|list|number|date — where the
   inference is wrong, `"stress": [...]` for values from the catalogue) and renders every variant × case.
   Findings: `stress-unescaped` / `stress-leak` (errors), `stress-empty-join` ("Hola ,", " te espera",
   ". Espera hace .") and `stress-long-token` (warnings). Fix the template or the builder's normalization,
   then open the worst stress cases in the inbox (`[` `]`) — a finding-free render can still look broken.
6. Gate: `$VE contract emails/<slug> --strict` exits 1 while any field has no declared source, and
   `$VE stress emails/<slug> --check --strict` exits 1 while any variant breaks on a stress case. The
   missing endpoints become issues/tasks before (or alongside) the port. `$VE render` gives the clean HTML.

## Non-negotiables (the linter enforces most)

- **Images are hosted.** Every `src` is an absolute `https://` URL that answers 2xx with an image type
  (`lint --net` proves it). No relative paths, `file:`, `localhost`, or `data:` URIs. If the asset is
  local, upload it first (the product's CDN/bucket, or a public repo's raw URL) — ask where.
- **Links are absolute https** to the public app URL, never `localhost` from a dev `.env`.
- **Tables for layout, CSS inlined**, `<style>` only for progressive enhancement (mobile + dark).
- 600px container, ≥16px body text on mobile, ≥44px tap targets, bulletproof buttons.
- A real **preheader** and a subject that fit together (subject ≤ ~50 chars, preheader 40–90).
- **Dark mode designed, not left to chance**: `color-scheme` meta + `prefers-color-scheme` + `[data-ogsc]`.
  Check both "Dark" (client honours your styles) and "Forced dark" (client inverts) in the inbox.
- Under 102 KB of HTML or Gmail clips it. No JS, forms, SVG, video, `position`, flex/grid, CSS variables.
- Escape every user-supplied value that goes into the HTML (names, messages, summaries).
- **No sentence built around a value that can be empty**; every optional field has a designed absent state
  (`stress` proves it). User text cells carry `overflow-wrap:anywhere` so a 600-char word can't widen the card.

Full rule list with the clients each protects: `references/client-compat.md`.

## Hand-off (what the user sees)

Give them the inbox URL and the keys: `j/k` mail · `← →` variant · `m` mobile · `d` light/dark/forced ·
`i` images off · `z` fit ↔ 1:1 · `h` huecos (data sources) · `[` `]` case · `l` lint · `p` pick · `n` note. For async review, `shoot` and send `shots/index.html` (contact sheet).
Before saying anything looks good, open the PNGs — a screenshot is not evidence until you've looked at it.

## References

- `references/design-principles.md` — hierarchy, type, colour, dark mode, copy; the email anti-slop list.
- `references/components.md` — copy-paste blocks: button (+VML), stat tiles, key/value rows, list rows, 2-col stack, divider, footer, hosted image.
- `references/client-compat.md` — every lint rule, why it exists, which clients it protects.
- `references/capture-existing.md` — dump a product's real emails into the inbox.
- `references/real-data-first.md` — capture → catalogue with counts → rules → `stress`; required before variants.
- `references/data-contract.md` — template syntax, `contract.json`, cases, `fetch`, `stress`, huecos.
- `references/email-brand-template.md` — the `EMAIL-BRAND.md` skeleton.
- `examples/` — finished emails in different directions; `$VE serve <this-skill-dir>/examples` to browse them.
- `templates/starter.html` — the bulletproof skeleton `new` copies.
