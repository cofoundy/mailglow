#!/usr/bin/env bash
# check-private.sh — nothing private leaks into this public repo.
#
#   1. tracked (and new, not ignored) text files: absolute home paths (/home/<user>, /Users/<user>),
#      agent scratch paths, and e-mail addresses outside the example/fictional domains;
#   2. every term in MAILGLOW_PRIVATE_TERMS (comma list: client names, internal products, people)
#      in those text files, AND in the text OCR'd from every PNG in assets/ (tesseract).
#
# The denylist lives only in your environment — never commit it:
#   MAILGLOW_PRIVATE_TERMS="Acme Internal,Jane Doe" bash scripts/check-private.sh
# CI runs it without terms (text checks only). Exit 1 on any finding.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
say() { printf '  ✗ %s\n' "$*"; fail=1; }

mapfile -t files < <(git ls-files --cached --others --exclude-standard | grep -vE '\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf)$' | grep -vx 'scripts/check-private.sh' | while read -r f; do [[ -f "$f" ]] && echo "$f"; done)
echo "→ ${#files[@]} text files"

# 1a. Absolute home paths. Placeholders used in docs/tests (me, you, user, runner, …) are fine.
hits=$(grep -nHE '(/home/|/Users/)[A-Za-z0-9._-]+' "${files[@]}" 2>/dev/null \
  | grep -vE '(/home/|/Users/)(me|you|user|username|runner|name|example|alice|bob|<[a-z]+>)([/"'"'"' )`]|$)' || true)
[[ -n "$hits" ]] && { say "absolute home paths:"; echo "$hits" | sed 's/^/      /'; }

# 1b. Agent scratch / worktree paths.
hits=$(grep -nHE '/tmp/claude-|scratchpad/|\.herdr/|/private/var/folders/|/var/folders/[a-z0-9_]{2}/' "${files[@]}" 2>/dev/null || true)
[[ -n "$hits" ]] && { say "scratch paths:"; echo "$hits" | sed 's/^/      /'; }

# 1c. E-mail addresses outside example domains and the fictional brands of the example emails.
ALLOW='example\.(com|org|net)|example|test|invalid|localhost|relayhq\.io|tidemark\.dev|plotwise\.co|fieldnote\.app|acme\.com|product\.com|company\.com|b\.co|[a-z0-9-]+\.(png|jpe?g|gif|svg|webp)|users\.noreply\.github\.com'
hits=$(grep -noHE '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' "${files[@]}" 2>/dev/null \
  | awk '{n=split($0,a,"@"); printf "%s\t%s\n", tolower(a[n]), $0}' \
  | grep -vE "^([^[:space:]]*\.)?($ALLOW)"$'\t' | cut -f2- || true)
[[ -n "$hits" ]] && { say "non-example e-mail addresses:"; echo "$hits" | sed 's/^/      /'; }

# 2. Private terms: text files and OCR of the screenshots.
if [[ -n "${MAILGLOW_PRIVATE_TERMS:-}" ]]; then
  IFS=',' read -ra terms <<<"$MAILGLOW_PRIVATE_TERMS"
  echo "→ ${#terms[@]} private term(s) from MAILGLOW_PRIVATE_TERMS"
  for t in "${terms[@]}"; do
    t="$(echo "$t" | sed 's/^ *//; s/ *$//')"; [[ -z "$t" ]] && continue
    hits=$(grep -nHiF -- "$t" "${files[@]}" 2>/dev/null || true)
    [[ -n "$hits" ]] && { say "private term in text files:"; echo "$hits" | sed 's/^/      /'; }
  done
  if command -v tesseract >/dev/null; then
    shopt -s nullglob
    pngs=(assets/*.png)
    # Use whichever of eng/spa is installed; with neither, OCR cannot see anything — that is a failure,
    # not a pass (a silent tesseract error reads exactly like "no private text").
    have=$(tesseract --list-langs 2>/dev/null | tail -n +2)
    langs=$(for l in eng spa; do grep -qx "$l" <<<"$have" && echo "$l"; done | paste -sd+)
    if [[ -z "$langs" ]]; then say "tesseract has neither eng nor spa traineddata — install tesseract-data-eng"; pngs=(); fi
    echo "→ OCR ${#pngs[@]} PNG(s) in assets/ (${langs:-no language})"
    read_chars=0
    for p in "${pngs[@]}"; do
      if ! text=$(tesseract "$p" - -l "$langs" 2>/dev/null); then say "OCR failed on $p"; continue; fi
      read_chars=$((read_chars + ${#text}))
      # Compare accent- and case-insensitively: OCR often drops or mangles diacritics.
      flat=$(printf '%s' "$text" | iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]')
      for t in "${terms[@]}"; do
        t="$(echo "$t" | sed 's/^ *//; s/ *$//')"; [[ -z "$t" ]] && continue
        needle=$(printf '%s' "$t" | iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]')
        grep -qF -- "$needle" <<<"$flat" && say "\"$t\" is visible in $p"
      done
    done
    (( ${#pngs[@]} > 0 && read_chars < 200 )) && say "OCR read only $read_chars characters from ${#pngs[@]} screenshots — it is not working"
  else
    echo "  · tesseract not installed — screenshots NOT checked"
  fi
else
  echo "  · MAILGLOW_PRIVATE_TERMS unset — private-term and screenshot OCR checks skipped"
fi

# 3. --history: the same term checks over EVERY commit (text blobs + every PNG version). Publishing a repo
#    publishes its history; a screenshot fixed in the last commit is still public in the one before.
if [[ " $* " == *" --history "* && ${#terms[@]} -gt 0 ]]; then
  tmp=$(mktemp -d); nblob=0
  echo "→ history: $(git rev-list --all | wc -l) commits"
  for t in "${terms[@]}"; do
    t="$(echo "$t" | sed 's/^ *//; s/ *$//')"; [[ -z "$t" ]] && continue
    hits=$(git grep -I -i -l -F -- "$t" $(git rev-list --all) 2>/dev/null | head -5)
    [[ -n "$hits" ]] && { say "\"$t\" in history:"; echo "$hits" | sed 's/^/      /'; }
  done
  while read -r b; do
    [[ -f "$tmp/$b.png" ]] && continue
    git cat-file -p "$b" > "$tmp/$b.png"; nblob=$((nblob+1))
    flat=$(tesseract "$tmp/$b.png" - -l "${langs:-eng}" 2>/dev/null | iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]')
    for t in "${terms[@]}"; do
      t="$(echo "$t" | sed 's/^ *//; s/ *$//')"; [[ -z "$t" ]] && continue
      needle=$(printf '%s' "$t" | iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]')
      grep -qF -- "$needle" <<<"$flat" && say "\"$t\" visible in a past PNG ($(git log --all --format=%h --find-object="$b" | tr '\n' ' '))"
    done
  done < <(for c in $(git rev-list --all); do git ls-tree -r "$c" | awk '$4 ~ /\.png$/ {print $3}'; done | sort -u)
  echo "  · OCR'd $nblob historical PNG version(s)"
fi

[[ $fail -eq 0 ]] && echo "✓ nothing private found" || { echo "✗ private data found"; exit 1; }
