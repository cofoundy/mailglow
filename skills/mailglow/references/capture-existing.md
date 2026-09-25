# Capture a product's existing emails

Goal: every email the product can send, rendered by **the code that sends it**, in one folder the inbox
can open. Never copy HTML out of the codebase by hand — the copy is stale the day someone edits the builder.

## 1. Census

Find every sender and every builder. Grep for the send seam and walk back to the HTML:

```bash
grep -rnE "send_email|sendMail|Emails\.send|resend|postmark|sendgrid|ses\.send|smtplib|nodemailer|render\(<" src/
```

For each email record: slug, subject, trigger (what event sends it), the builder (`file:line`), inputs.
Look for the forgotten ones: password reset, invites, email verification, digests, failure alerts.

## 2. Dump script (lives next to the code, not in this skill)

Shape — any language:

1. Block the network and never touch the database (monkeypatch/mocks).
2. If a builder is entangled with sending, **intercept the send seam** and keep the payload
   (`html`, `subject`, `from`) instead of calling the provider.
3. Call every builder with **realistic fixture data** in the product's language: real-looking names,
   long and short values, the empty/missing case (contact without a name, no phone).
4. Set the **public** app base URL (`FRONTEND_URL=https://app.product.com`) so links aren't `localhost`.
5. Write `<out>/<slug>.html` and `<out>/manifest.json`:

```json
[{ "slug": "lead-hot", "subject": "Lead caliente: Diego Ramos", "from_name": "Acme",
   "from_email": "noreply@example.com", "preheader": "…", "trigger": "awaiting-reply sweep, qualified lead",
   "source": "backend/src/services/notifications.py:324" }]
```

Variations of one email (the 9 kinds of an alert, with/without a link) get their own slug:
`silent-failure-agent-turn`, `silent-failure-channel-silent`.

Python sketch:

```python
import json, socket, sys
from pathlib import Path

def block_network():
    def no(*a, **k): raise RuntimeError("network blocked")
    socket.socket.connect = no; socket.create_connection = no

def main(out: Path):
    out.mkdir(parents=True, exist_ok=True); block_network()
    import resend                                  # the provider SDK the product uses
    captured = []
    resend.Emails.send = lambda p: captured.append(p) or {"id": "dry"}
    from app.emails import render_welcome, send_password_reset   # the REAL builders
    manifest = []
    def emit(slug, subject, html, trigger, fn):
        (out / f"{slug}.html").write_text(html)
        manifest.append({"slug": slug, "subject": subject, "trigger": trigger, "source": f"{fn.__module__}.{fn.__name__}"})
    subject, html = render_welcome(name="Ana Torres", workspace="La Esquina Café")
    emit("welcome", subject, html, "signup", render_welcome)
    send_password_reset("lucia@example.com", token="demo")        # entangled → captured
    p = captured.pop(); emit("password-reset", p["subject"], p["html"], "forgot password", send_password_reset)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__ == "__main__": main(Path(sys.argv[1]))
```

For React Email / MJML / Maizzle the "builder" is the compiler: render each template with fixture props
to HTML (`render(<Welcome {...props} />)`, `mjml -o`, `maizzle build`) into the folder.

## 3. Look, then report

```bash
$VE lint  <out>                     # errors first
$VE shoot <out> --schemes light,dark,forced
$VE serve <out> --open
```

Open the screenshots before writing anything. Per email, report: when it fires, lint errors, and what is
visibly wrong (dark-mode contrast, mobile overflow, missing preheader, fragment without a background).
Then — and only then — start the iterate loop on the ones worth redesigning.

## Common findings in hand-rolled emails

- **Fragments** (a `<div>` with no `<html>/<body>`): no background, no width control, no preheader.
- **Hardcoded light colours, no dark mode**: dark text on the client's dark background.
- `max-width` on a `div` (Outlook ignores it), padded `<a>` buttons (square in Outlook).
- **Unescaped user data** interpolated into HTML (contact names, messages) — an injection risk, and a
  layout risk when someone's name contains `<`.
- Links built from a dev `.env` → `http://localhost:3000/...` in production-looking emails.
