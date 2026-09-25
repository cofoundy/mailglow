# Real data first

An email is a frame around data a stranger typed. Designing it on one tidy example ("Ana Torres",
one clear message, a phone number, a 60-character note) produces a layout that fits *that* example
and breaks on the first real one. The fix is procedural: **look at the real distribution before
drawing anything**, and keep the ugly cases in the inbox next to the pretty one.

## Why it's a required step

The pattern repeats: a design gets approved on the happy path, then production brings emoji-only names
(`🌼🌼🌼`), provider placeholders (`WhatsApp User`), "fancy" Unicode names (`𝓜𝓪𝓻𝓲𝓪 ✨`),
ALL-CAPS names, 600-character notes, "ok" as the last message, eleven-message bursts from the bot,
no phone at all, and fields that simply aren't there. None of these are rare: in one audit of **166
real handoff notifications, 43 carried a name that could not go into a greeting as-is**, and the
"last message" the design put front and centre **was not enough to act on in 14 of 40**. Every one of
those was visible in the data before the first variant was drawn.

## The method

### 1. Capture 10–40 real instances

Of exactly what the email will carry, from where it will come from — the database, the API, the logs,
the event that triggers the send. Not "some customers": the last N times this email *would have
fired*. Read-only credentials, staging if it has real traffic, and keep the dump out of git (a scratch
folder, or `cases/*.json` in a gitignored directory).

Fewer than 10 hides the tails; more than 40 rarely adds a new shape. If the email doesn't exist yet,
capture the data of the event it will announce.

### 2. Catalogue the shapes, with counts

For every field the email shows, one line per shape and how many instances have it:

```
contact.name     clean "Nombre Apellido" 118 · ALL CAPS 17 · emoji-only 9 · placeholder 11
                 · fancy Unicode 6 · single word 5            → 43/166 not greeting-safe
contact.phone    present 131 · missing 35 (username-only identity)
note             median 194 chars · max 625 · internal jargon in 7/8
last message     actionable 26/40 · "ok"/"gracias"/emoji 9 · media-only 5
messages         1–3: 22 · 4–10: 12 · 11+ (bot bursts): 6
```

Counts, not adjectives. "Names are sometimes messy" doesn't change a design; "26% of names can't
follow *Hola,*" does.

### 3. Derive the rules

Each shape becomes a decision the design and the builder share, written next to the contract:

- **Normalization** — e.g. first name = first word, title-cased, only if it has letters; emoji-only or
  placeholder → a neutral fallback ("Tu cliente"). Decide it once, in the builder, not per template.
- **How much context** — if the last message is insufficient in a third of cases, show the last 3,
  filtered (no internal notes, media labelled "📷 Photo"), not 1 — and cap it; 11 bubbles is a wall.
- **Length budgets** — a note that can reach 625 chars gets a hard cap in code with an ellipsis, or a
  generated one-liner with a fallback. The template never trusts the length.
- **Absent fields** — every optional field has a designed "not there" state (`{{^phone}}…{{/phone}}`),
  and no sentence is built around a value that can be empty ("Hola, {{name}}" → "Hola{{#name}}, {{name}}{{/name}}").

These rules are what the variants are then allowed to assume.

### 4. Turn the catalogue into cases, then `stress`

Save 3–5 real instances that span the shapes as `cases/<name>.json` (anonymize if needed — keep the
*shape*: an emoji name stays an emoji name). Then:

```bash
$VE stress emails/<slug> --from <a-real-case>
```

writes `cases/stress-*.json` — empty, missing, emoji/fancy/placeholder/CAPS names, very long text,
600-char words, HTML-looking values, lists with 0/1/12/media-only items, no phone — derived from the
contract's field kinds, and renders every variant with every case. Add the specific values your
catalogue found to the contract so they're replayed forever:

```json
"contact.name": { "status": "existe", "kind": "name", "stress": ["🌼🌼🌼", "WhatsApp User", "MARIANA GUTIERREZ"] }
```

### 5. Review the worst case, not the best

In the inbox, `[` `]` walk the cases — stress cases come after the real ones. A variant is a candidate
only when the *worst* case still reads as a finished email. `stress --strict` exits 0 before porting.

## Anti-patterns

- Choosing the base case because it looks good. Choose the median, then stress it.
- "We'll handle long names in CSS" — overflow is one of five failure shapes; empty joins, placeholders
  and missing context are copy and data problems CSS can't touch.
- Fixing a shape in one variant's template. Normalization belongs in the builder so every variant and
  every future email gets it.
- Treating the catalogue as a one-off. Re-run it when the data source changes (a new channel, a new
  provider, a new locale).
