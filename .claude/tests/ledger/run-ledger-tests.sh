#!/usr/bin/env sh
# run-ledger-tests.sh — deterministic tests for ledger-prune.sh.
#
# The repo context ledger is read before every run's current-state walk, so two
# properties have to hold and neither is checkable by reading prose: a dead
# anchor must go, and everything else must survive BYTE-IDENTICAL. A prune that
# quietly rewrites or drops what it cannot verify would turn the read-before-walk
# rule from a saving into a liability.
#
# Invocation: sh run-ledger-tests.sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PRUNE="$ROOT/.claude/orchestrator/references/ledger-prune.sh"

. "$HERE/../lib/assert.sh"

echo "Running ledger tests..."
echo

if [ ! -f "$PRUNE" ]; then
  echo "skip: ledger-prune.sh absent"
  finish "ledger tests"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

# --- fixture repo ------------------------------------------------------------
# A live file with a live symbol, a live file whose symbol was renamed away, a
# path that no longer exists, a directory, and prose with no anchor at all.
mkdir -p "$work/src" "$work/.workflow" "$work/lib"
cat > "$work/src/feed.js" <<'EOF'
export function lastN(items, n) { return items.slice(-n) }
EOF
cat > "$work/src/money.js" <<'EOF'
export function toCents(x) { return Math.round(x * 100) }
EOF

write_ledger() {
  cat > "$work/.workflow/CONTEXT.md" <<'EOF'
# Repo context ledger

## feed

- `src/feed.js#lastN` — window helper, callers pass a count — [0001-feat-window]
- `src/feed.js#dropLastN` — renamed away in a later run — [0002-refactor-feed]
- `src/gone.js#whatever` — file deleted since — [0003-chore-cleanup]

## Test infra

- `lib#fixtures` — directory, cannot be grepped — [0001-feat-window]
- runner is node --test, no anchor on this line — [0001-feat-window]
- `src/money.js#toCents` — cents discipline lives here — [0004-fix-money]
EOF
}

# --- 1. a dead anchor and a dead file are dropped; nothing else is ------------
write_ledger
before_live="$(grep -c 'lastN\|toCents\|fixtures\|node --test' "$work/.workflow/CONTEXT.md")"
out="$(sh "$PRUNE" "$work/.workflow/CONTEXT.md" 2>/dev/null)"
assert_contains "prune reports the tally" "$out" "dropped=2"
assert_file_contains "live symbol survives" "$work/.workflow/CONTEXT.md" "src/feed.js#lastN"
assert_file_contains "second live symbol survives" "$work/.workflow/CONTEXT.md" "src/money.js#toCents"
if grep -q 'dropLastN' "$work/.workflow/CONTEXT.md"; then
  fail "renamed-away anchor dropped"
else
  pass "renamed-away anchor dropped"
fi
if grep -q 'src/gone.js' "$work/.workflow/CONTEXT.md"; then
  fail "deleted-file fact dropped"
else
  pass "deleted-file fact dropped"
fi

# --- 2. unverifiable lines are KEPT, not guessed at ---------------------------
assert_file_contains "heading kept" "$work/.workflow/CONTEXT.md" "# Repo context ledger"
assert_file_contains "area heading kept" "$work/.workflow/CONTEXT.md" "## Test infra"
assert_file_contains "directory path kept" "$work/.workflow/CONTEXT.md" "lib#fixtures"
assert_file_contains "anchorless prose kept" "$work/.workflow/CONTEXT.md" "runner is node --test"
after_live="$(grep -c 'lastN\|toCents\|fixtures\|node --test' "$work/.workflow/CONTEXT.md")"
assert_eq "no live line lost" "$before_live" "$after_live"

# --- 3. a kept line survives byte-identical ----------------------------------
write_ledger
cp "$work/.workflow/CONTEXT.md" "$work/expected.md"
grep -v 'dropLastN' "$work/expected.md" | grep -v 'src/gone.js' > "$work/expected2.md"
sh "$PRUNE" "$work/.workflow/CONTEXT.md" >/dev/null 2>&1
if diff -q "$work/expected2.md" "$work/.workflow/CONTEXT.md" >/dev/null; then
  pass "surviving lines are byte-identical"
else
  fail "surviving lines are byte-identical — prune rewrote content it should only have kept"
fi

# --- 4. --dry-run changes nothing --------------------------------------------
write_ledger
sum_before="$(cksum < "$work/.workflow/CONTEXT.md")"
out="$(sh "$PRUNE" "$work/.workflow/CONTEXT.md" --dry-run 2>/dev/null)"
sum_after="$(cksum < "$work/.workflow/CONTEXT.md")"
assert_eq "dry run leaves the file untouched" "$sum_before" "$sum_after"
assert_contains "dry run still reports the tally" "$out" "dropped=2"

# --- 5. an absent ledger is not an error -------------------------------------
if sh "$PRUNE" "$work/.workflow/NOPE.md" >/dev/null 2>&1; then
  pass "absent ledger exits 0 (a first run has nothing to prune)"
else
  fail "absent ledger exits 0 (a first run has nothing to prune)"
fi

# --- 6. an all-dead ledger does not leave a truncated file behind -------------
mkdir -p "$work/empty/.workflow"
cat > "$work/empty/.workflow/CONTEXT.md" <<'EOF'
# Repo context ledger

- `src/nope.js#gone` — [0001]
EOF
sh "$PRUNE" "$work/empty/.workflow/CONTEXT.md" >/dev/null 2>&1
assert_file_contains "header survives an all-dead ledger" "$work/empty/.workflow/CONTEXT.md" "# Repo context ledger"

finish "ledger tests"
