# Design principles for email

An email is read in three places, in this order: the inbox row, the first screen on a phone, the rest.
Design for that order.

## 1. The inbox row (sender · subject · preheader)

- **Sender** is a name people recognise (`Acme`, `Maria at Acme`), never `noreply`.
- **Subject** states the outcome or the ask in ≤ ~50 characters. Put the specific noun first
  ("Jorge is waiting for a reply", not "[Acme] Notification: lead update").
- **Preheader** finishes the subject's thought — it is not a repeat and not "View in browser".
- Bracket tags (`[Acme]`) and decorative emoji spend the most valuable characters on nothing.
  One emoji can carry meaning in an alert; as decoration it reads as marketing.

## 2. The first phone screen (~390 × 600 px)

Everything needed to act must fit here: what happened → why it matters → the one button.

- **One job per email.** One primary button. Secondary actions are text links, below.
- **Hierarchy**: eyebrow (optional, small caps, muted) → headline (the outcome, 24–30px) → one or two
  sentences (16px, 1.5–1.6 line-height) → button → details.
- Details (tables of values, line items, lists) go **below** the button. People scan them only if they
  decided to act.

## 3. Type

- System stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
  A web font is an enhancement for Apple Mail only; the fallback is what most people see.
- Serif for editorial/brand voice: `Georgia, 'Times New Roman', serif` — renders everywhere.
- Two weights (400 + 600/700) and three sizes do most emails. Tight letter-spacing (-0.01 to -0.02em)
  on headlines only.
- Body ≥ 16px on mobile. Muted text ≥ 13px and ≥ 4.5:1 contrast.

## 4. Colour and dark mode

- Define the palette as roles, twice: light and dark — page, card, ink, ink-2 (secondary), ink-3 (muted),
  rule (borders), accent, accent-ink (text on accent).
- Never rely on a colour to carry meaning alone (the red "urgent" needs a word too).
- Dark mode has three behaviours in the wild — design for all three:
  1. **No change** (older clients) → light version must stand alone.
  2. **Honours your styles** (Apple Mail, iOS Mail, Outlook.com via `[data-ogsc]`, some Outlook apps) →
     your `@media (prefers-color-scheme: dark)` rules apply.
  3. **Forced inversion** (Gmail apps, Outlook apps) → the client flips light colours to dark on its own.
     Avoid pure-white logos on transparent PNGs, text baked into images, and borders that are the only
     thing separating areas.
- Test "Dark" and "Forced dark" in the inbox. Contrast problems show up there first.

## 5. Layout

- 600px container, 32–44px inner padding on desktop, 24px on mobile.
- Mobile: columns stack, buttons go full-width, padding shrinks — nothing else needs to change if the
  hierarchy is right.
- Whitespace separates better than lines. Use one hairline rule style, used consistently.
- Cards on a tinted page background look designed; a white card on a white page looks like a fragment.

## 6. Copy

- Write like a person who respects the reader's time: specific, short, no throat-clearing.
- Button labels are verbs + object: "Open the conversation", "Review the broadcast". Never "Click here",
  never "Submit".
- Put numbers where they decide: "3 leads waiting · oldest 1h 35m" beats "Some leads are waiting".
- Transactional emails still need a reason-for-receiving line and a way to change notification settings.

## Email anti-slop — delete on sight

- Gradient hero banner with a stock illustration and no information in it.
- "Hey there 👋" / "We're excited to announce" / "Just a friendly reminder".
- Everything centred, including paragraphs and tables.
- Three equal-weight buttons.
- ALL-CAPS paragraphs, text-shadow, drop-shadow on everything.
- A logo 200px wide above a one-line message.
- Grey-on-grey muted text that fails contrast in dark mode.
- Social icon rows in a password reset.
- A 5-link footer menu on an operational alert.
- Tables of data where the most important value isn't the boldest thing in its row.

## Structural directions (for variants that genuinely differ)

Use these to force round-1 variants apart — pick three from different rows:

| Direction | Hierarchy | Feel |
|---|---|---|
| **Editorial letter** | serif headline, prose-first, button late | calm, human, founder-voice |
| **Utility card** | data block first, button pinned under it | operational, fast to scan |
| **Bold statement** | one huge line + one button, nothing else above the fold | urgent, confident |
| **Receipt / ledger** | rows and totals, monospaced figures, minimal chrome | trustworthy, exact |
| **Digest** | stat tiles, then a ranked list | overview, skimmable |
| **Plain text-like** | no card, no colour, 1–2 links | personal, high deliverability |
