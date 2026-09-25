# Data contract — templates, cases, huecos

A picked design becomes a **template** (fields instead of data), a **contract** (where every field comes
from) and **cases** (real data to render it with). Same folder as the variants:

```
emails/requiere-humano/
├── a.html  b.html  c.html      templates: {{fields}}
├── contract.json               field → endpoint + path + status
└── cases/
    ├── demo.json               hand-written
    └── maya.json               built by `fetch` from the real API
```

## Template syntax (mustache subset)

| | |
|---|---|
| `{{contact.name}}` | value, HTML-escaped (always — names come from strangers) |
| `{{{brief_html}}}` | raw HTML (only for values you produce yourself) |
| `{{#messages}}…{{/messages}}` | loop over a list (`{{author}}`, `{{text}}`, `{{.}}` inside), or a block if truthy |
| `{{^brief}}…{{/brief}}` | only when empty/missing |
| `{{! note }}` | comment |

Fields work in text, attributes (`href="…?c={{conversation.id}}"`) and `<meta name="mail:subject">`.
Inside a loop the field key is `messages[].text`; the contract can declare it or just `messages`.

## contract.json

```json
{
  "params": { "conversation_id": "con_01J…" },
  "fields": {
    "contact.name":    { "status": "existe", "endpoint": "GET /conversations/{conversation_id}", "path": "contact.name",
                         "backend": "notify_lead(contact_name=…)" },
    "messages":        { "status": "existe", "endpoint": "GET /conversations/{conversation_id}/messages?limit=3", "path": "data[-3:]" },
    "brief":           { "status": "falta",  "endpoint": "GET /conversations/{conversation_id}/handoff-brief",
                         "note": "qué quiere — qué falta, ≤140 chars", "sample": "Mesa para 12 el sábado — falta confirmar" }
  }
}
```

- `status`: `existe` (an endpoint returns it today) · `deriva` (the data exists — name it in `source`, e.g.
  `conversations.last_customer_message_at` — but a rule or an endpoint must expose it) · `falta` (the data does
  not exist anywhere: name what must be built) · anything else or absent = **sin origen** (`contract --strict`
  and `lint` flag it). Don't map everything to a future endpoint as `falta`: that hides which data is really
  missing. Huecos colours: green existe, blue deriva, amber falta, red sin origen.
- `path`: dots, `[0]`, `[-1]`, slices `[-3:]` into the endpoint's JSON.
- `sample`: what renders while the endpoint doesn't exist (and for `fetch` fallbacks).
- Extra keys (`backend`, `note`, `owner`, `issue`) are free-form and shown in the report.

## Cases

`$VE fetch emails/<slug> --base https://api.example.com --name maya --param conversation_id=con_… --header "X-API-Key: $KEY"`
calls each distinct `existe` endpoint once, extracts the paths, fills `falta` fields from samples and
writes `cases/maya.json` with a `_meta` block saying which fields came from the API. Use read-only
credentials, prefer staging, and keep real customer data out of git.

## Huecos (the toggle)

`h` in the inbox, or `/raw/<slug>/<variant>?huecos=1`: every field is outlined — green exists, amber
endpoint missing, red no source — and hovering shows `existe · GET /conversations/{id} → contact.name`.
It's a preview layer only: `render` and every non-huecos view output clean HTML.

## Stress cases

`$VE stress emails/<slug> [--from <case>]` derives `cases/stress-<shape>.json` from the contract and a
base case (default: the first real one) — what production actually sends, not what the design was
drawn on. Why this matters and how to pick the base: `real-data-first.md`.

| shape | applies to | value |
|---|---|---|
| `missing` · `empty` | every field | `null` · `""` / `[]` / `0` |
| `no-phone` | phone | `null` |
| `name-emoji` · `name-fancy` · `name-placeholder` · `caps` | name (+ list item names) | `🌼🌼🌼` · `𝓜𝓪𝓻𝓲𝓪 ✨ …` · `WhatsApp User` · UPPERCASE |
| `short` · `long` · `long-token` | text / longtext (last list item for `short`) | `ok` · 620+ chars · 620 chars, no spaces |
| `html` | every string | `<b>x</b> & <i>field</i>` — must come out escaped |
| `list-0` · `list-1` · `list-many` · `list-media` | list | 0 · 1 · 12 items · items with empty text |
| `number-zero` · `number-big` | number | `0` · `1234567.89` |
| `custom-<field>-<n>` | a field with `"stress": [...]` | each declared value |

Per field in `contract.json`:

```json
"contact.name": { "status": "existe", "kind": "name", "stress": ["🌼🌼🌼", "WhatsApp User"] },
"internal_ref": { "status": "existe", "stress": false }
```

- `kind`: `name` · `text` · `longtext` · `phone` · `url` · `list` · `number` · `date` · `id` — inferred
  from the key and the sample when absent (`*name*`/`author` → name, `motivo`/`content`/`note` or >120
  chars → longtext, `*_id` → id, arrays → list…). The command prints every field's kind: fix the wrong ones.
- `stress`: extra values replayed as their own cases; `false` excludes the field.
- Item fields of a list come from `messages[].content`-style keys or the first item's keys.

Every stress case carries `_meta: { stress: true, shape, base, note, fields }` so the inbox can group
them; `listCases` puts `stress-*` after the real cases so `cases[0]` stays a real one. Output is
deterministic (fixed values, no timestamps); re-running replaces every `stress-*` file and never touches
hand-written cases.

After writing, every template variant is rendered with every case and compared with the base render
(copy identical in the base is authored text and never flagged):

| rule | severity | fires when |
|---|---|---|
| `stress-unescaped` | error | an HTML-looking value appears verbatim (a `{{{raw}}}` on stranger data) |
| `stress-leak` | error | `undefined` / `null` / `NaN` / `[object Object]` becomes visible text |
| `stress-empty-join` | warn | a new text run (body, subject or preheader) reads broken: space before punctuation (`Hola ,`), starts with punctuation (`. Espera hace .`), ends with a comma, two separators with nothing between, empty brackets, or — in `missing`/`empty` — a lowercase phrase right after a tag (` te espera`) |
| `stress-long-token` | warn | the 600-char word renders and no `overflow-wrap`/`word-break` exists in the email |

`--check` only checks (writes nothing); `--strict` exits 1 on warnings too; `--json` for tooling.
