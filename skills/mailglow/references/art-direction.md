# Art direction — from a target image to bulletproof HTML

Why this exists: a real redesign went three rounds of typography-only directions ("correct", 23–27/40 on a
usability critique) and the verdict was still "ugly and plain". The fix was not a fourth layout — it was a
target picture made with an image model, then HTML that replicated it layer by layer.

## 1. Round 0 — brainstorm in images

- 5–8 full email mockups, one per world (a kitchen ticket, an incoming call, the chat itself…), same content,
  real copy from a median case. Pass the brand's logo and palette as reference images so the model adopts them
  instead of inventing a plausible fake brand.
- If the user brings their own generated reference, it IS round 0: start from it.
- Pick or mix, then write down the target's inventory before touching HTML — every layer and detail you can see:
  panels and their edges, translucency, folds, crests, waves, the type pairing (two-tone name, script accent),
  icon tiles, tinted cards, the pill button and its shadow, the footer seal. Replicating means ticking that list.

## 2. Keep the shapes: edit the target, don't redraw it

Organic curves, folded sheets and layered translucent panels are what make the target feel designed, and they are
the part you will get wrong if you redraw them (Bézier guesses in PIL/SVG look flat and "almost"). Instead:

- **Image edit** the target: "remove only the logo and the text on the left, keep every shape identical" → a clean
  art plate with the exact curves.
- **Same plate, new subject** for sibling emails: "keep everything identical, replace only the 3D subject with …".
  The curves stay pixel-consistent across the system.
- **Recompose** with an edit, not a new generation, when you need another aspect (portrait for mobile, a wide band).

## 3. The hero band (what survives every client)

Email can't overlay layers (no `position`, `clip-path`, `mask`, SVG). So:

```
┌──────────────────────────────┐
│ art: photo + curves (image)  │  background-image on the hero <td>, size 100% auto, position top
│ ~~~~~ curve hands off ~~~~~~ │
│ flat colour (= td bgcolor)   │  ← every word lives here: script accent, name, ask, button, meta line
│ …text grows freely…          │
└──────────────────────────────┘
  wave PNG (flat colour → card)     transparent below, one per exact flat colour
```

- Crop the art so its bottom rows are the flat colour; sample that colour and use it as the hero `bgcolor`, the
  VML fill and the wave PNG — no seam, and the hero can grow with any content length.
- **Text never sits on the photo.** Put a spacer (`hero-gap`) so text starts where the flat colour starts; compute
  it from the image, per breakpoint. Brand wordmarks next to the logo that land on the photo on mobile: hide them.
- Images off → the hero is a flat colour with every word and the button intact. Check with `i` in the inbox.
- Outlook: `v:rect` + `v:fill type="frame"` with the same image and colour.
- Weight: JPEG progressive, 1200 px wide, ~50–80 KB each.

## 4. Words are never inside the art

- One textless plate serves every language; the script accent ("Welcome to the team!") is live text:
  `@font-face` in `<style>` pointing at a hosted woff2, then a system script fallback chain —
  `'Caveat Brush','Segoe Script','Bradley Hand','Snell Roundhand','Brush Script MT',cursive` — so Gmail and
  Outlook (no webfonts) still render a handwritten face. Underline with a border, rotation is a bonus.
- If a word must be in the art, it's one asset per language — say so, it's a maintenance cost.

## 5. Details that carry "designed"

- Two-tone headline: the name in white, the ask/outcome in the accent colour; a short accent rule under it.
- Icons as hosted 2× PNGs (e.g. Lucide rendered with `rsvg-convert`), in tinted tiles or solid circles.
- One tinted card (radius 16–18) for the fact the reader needs; pill button full width with a gradient and a
  soft shadow (progressive: Gmail drops it); a small footer seal (transparent PNG, light and dark versions).
- Dark mode: move the whole palette into the brand's dark family (not a generic brown-grey); swap light/dark
  versions of any transparent art via `prefers-color-scheme` + `[data-ogsb]`.

## 6. Critique against the target

Score beauty /10 per email against the target picture, and list the concrete missing detail ("the fold at the
top", "the crest over the wave"). A usability score alone will pass a design the user finds ugly.
