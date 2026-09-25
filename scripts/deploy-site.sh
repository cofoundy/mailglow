#!/usr/bin/env bash
# Build the gallery/landing and deploy it as a Cloudflare Worker with static assets on mailglow.cofoundy.dev.
# NOINDEX=1 (default while the repo is private) adds X-Robots-Tag + a Disallow-all robots.txt.
# Needs CLOUDFLARE_API_TOKEN (Workers Scripts + DNS write) and CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")/.."
NOINDEX="${NOINDEX:-1}"
OUT=".deploy/site-$(date +%s)"
node skills/mailglow/scripts/mailglow.mjs gallery --out site
mkdir -p "$OUT" && cp -r site/. "$OUT/" && mv "$OUT/config.json" "$OUT/../config.json.last"
if [ "$NOINDEX" = 1 ]; then
  printf '/*\n  X-Robots-Tag: noindex, nofollow\n' > "$OUT/_headers"
  printf 'User-agent: *\nDisallow: /\n' > "$OUT/robots.txt"
fi
cat > "$OUT/wrangler.jsonc" <<JSON
{ "name": "mailglow", "compatibility_date": "2026-09-23",
  "assets": { "directory": ".", "not_found_handling": "404-page" },
  "routes": [{ "pattern": "mailglow.cofoundy.dev", "custom_domain": true }] }
JSON
printf 'wrangler.jsonc\n' > "$OUT/.assetsignore"
(cd "$OUT" && npx --yes wrangler deploy)
echo "deployed $OUT (NOINDEX=$NOINDEX) → https://mailglow.cofoundy.dev"
