#!/usr/bin/env bash
# validate-skills.sh — frontmatter present (name+description), name matches dir, manifest↔disk parity.
# Reusable: the scaffolder copies this into each new OSS repo; CI runs it. Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
echo "→ Validating skills/*/SKILL.md frontmatter"
for dir in skills/*/; do
  name="${dir#skills/}"; name="${name%/}"
  f="${dir}SKILL.md"
  if [[ ! -f "$f" ]]; then echo "  ✗ $name: missing SKILL.md"; fail=1; continue; fi
  grep -qE '^name:' "$f"        || { echo "  ✗ $name: SKILL.md missing 'name:'"; fail=1; }
  grep -qE '^description:' "$f" || { echo "  ✗ $name: SKILL.md missing 'description:'"; fail=1; }
  [[ $fail -eq 0 ]] && echo "  ✓ $name"
done

echo "→ Cross-checking marketplace manifest ↔ disk"
manifest=".claude-plugin/marketplace.json"
listed=$(grep -oE '"\./skills/[^"]+"' "$manifest" | sed 's|"./skills/||; s|"||')
for s in $listed; do
  [[ -d "skills/$s" ]] || { echo "  ✗ manifest lists skills/$s but it is missing on disk"; fail=1; }
done
for dir in skills/*/; do
  name="${dir#skills/}"; name="${name%/}"
  echo "$listed" | grep -qx "$name" || { echo "  ✗ skills/$name on disk but not in manifest"; fail=1; }
done

[[ $fail -eq 0 ]] && echo "✓ all skills valid" || { echo "✗ validation failed"; exit 1; }
