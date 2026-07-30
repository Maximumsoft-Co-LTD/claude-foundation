#!/usr/bin/env sh
# ledger-prune.sh — drop provably-dead facts from the repo context ledger.
#
# `.workflow/CONTEXT.md` is read before every run's current-state walk, so its
# whole value rests on being true. A stale ledger is worse than no ledger: it is
# a cost that also misleads. Every fact line carries a `path#anchor`, which makes
# staleness DETERMINISTIC to detect — the file is gone, or the anchor no longer
# appears in it — so this runs as a grep instead of a judgement call, at no model
# cost. Called from retro's repo-level fold (`agents/retro.md` step 5b).
#
# Usage:
#   sh ledger-prune.sh [<ledger>] [--dry-run]
#
# <ledger> defaults to `.workflow/CONTEXT.md` under the current directory. Repo
# root is taken as the ledger's grandparent, so paths resolve the way the facts
# were written. Exit 0 whether or not anything was pruned; exit 1 only on a
# usage/IO error, so a retro can call it unconditionally.
#
# CONSERVATIVE BY DESIGN. A line is dropped only when its anchor is PROVEN dead.
# Headings, prose, blockquotes, lines with no `path#anchor`, directory paths and
# globs are all KEPT — pruning what you cannot check is data loss wearing the
# costume of hygiene. The failure mode this guards against is a ledger that
# quietly rots; the failure mode it must not cause is a ledger that quietly
# shrinks.
set -eu

ledger=""
dry=0
for a in "$@"; do
  case "$a" in
    --dry-run) dry=1 ;;
    -*) echo "usage: ledger-prune.sh [<ledger>] [--dry-run]" >&2; exit 1 ;;
    *) ledger="$a" ;;
  esac
done
[ -n "$ledger" ] || ledger=".workflow/CONTEXT.md"

# Absent ledger is not an error: a repo's first run has nothing to prune.
[ -f "$ledger" ] || { echo "ledger-prune: no ledger at $ledger (nothing to do)"; exit 0; }

dir="$(cd "$(dirname "$ledger")" && pwd)"
root="$(dirname "$dir")"
base="$(basename "$ledger")"
tmp="$dir/.$base.prune.$$"
: > "$tmp"

kept=0
dropped=0

# `IFS=` + `read -r` preserves leading whitespace and backslashes verbatim; a
# kept line must survive byte-identical or the ledger is being rewritten rather
# than pruned.
while IFS= read -r line || [ -n "$line" ]; do
  # First backticked token containing '#' is the line's subject by the fold's
  # format (`- \`path#anchor\` — fact — [run-id]`). `^[^\`]*` cannot cross a
  # backtick, so this anchors on the FIRST token and never grabs a later one.
  ref="$(printf '%s\n' "$line" | sed -n 's/^[^`]*`\([^`]*#[^`]*\)`.*$/\1/p')"
  if [ -z "$ref" ]; then
    printf '%s\n' "$line" >> "$tmp"; kept=$((kept + 1)); continue
  fi

  path="${ref%%#*}"
  anchor="${ref#*#}"

  # Unverifiable shapes are kept, not guessed at.
  case "$path" in
    *'*'*|*/) printf '%s\n' "$line" >> "$tmp"; kept=$((kept + 1)); continue ;;
  esac
  if [ -d "$root/$path" ]; then
    printf '%s\n' "$line" >> "$tmp"; kept=$((kept + 1)); continue
  fi
  if [ -z "$anchor" ]; then
    printf '%s\n' "$line" >> "$tmp"; kept=$((kept + 1)); continue
  fi

  if [ ! -f "$root/$path" ]; then
    dropped=$((dropped + 1)); echo "  dropped (file gone):   $ref" >&2; continue
  fi
  if ! grep -qF -- "$anchor" "$root/$path" 2>/dev/null; then
    dropped=$((dropped + 1)); echo "  dropped (anchor gone): $ref" >&2; continue
  fi

  printf '%s\n' "$line" >> "$tmp"; kept=$((kept + 1))
done < "$ledger"

if [ "$dry" -eq 1 ]; then
  rm -f "$tmp"
  echo "ledger-prune: kept=$kept dropped=$dropped (dry run — $base unchanged)"
  exit 0
fi

mv "$tmp" "$ledger"
echo "ledger-prune: kept=$kept dropped=$dropped"
