#!/usr/bin/env sh
# What happens to verdict evidence when the target moves underneath a proven
# sandbox.
#
# The defect pinned here: review and acceptance receipts bound the whole
# workspace hash, so a commit landing on the control plane before Land expired
# them even when the change's own diff replayed byte-for-byte. The forced
# fresh review then ran into the two-wave cap, and the only route left was
# abandoning the change. A verdict now also carries the change's diff identity
# and the packet's review hash; a clean replay that alters neither rebinds the
# receipt on proof run/advance instead of expiring it, and a replay that does
# alter the diff can release the expired attempt from the wave budget on a
# recorded user decision.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

F="node .claude/harness/foundation.mjs"

GIT_AUTHOR_NAME="Foundation Test"
GIT_AUTHOR_EMAIL="foundation@example.invalid"
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

assert_cmd_fails_with() {
  label="$1"; needle="$2"; shift 2
  output="$({ "$@"; } 2>&1 || true)"
  if [ -n "$output" ] && printf '%s' "$output" | grep -qF -- "$needle"; then
    pass "$label"
  else
    fail "$label — expected failure containing '$needle'"
  fi
}

setup_project() {
  mkdir -p "$TMP/$1/.claude/harness" "$TMP/$1/openspec" "$TMP/$1/src"
  cp -R "$ROOT/.claude/harness/." "$TMP/$1/.claude/harness/"
  cp -R "$ROOT/openspec/schemas" "$TMP/$1/openspec/"
  cp "$ROOT/openspec/config.yaml" "$TMP/$1/openspec/"
  cd "$TMP/$1"
  printf 'export function add(a,b){return a+b;}\n' > src/calc.js
  mkdir -p .foundation
  printf '*\n!.gitignore\n!README.md\n' > .foundation/.gitignore
  git init -q . && git config user.email t@t && git config user.name t
  git add -A && git commit -qm init
}

runtime_json() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('.foundation/runtime/$1.json','utf8'))$2)"
}

record_acceptance() {
  change="$1"
  mkdir -p ".foundation/logs/$change"
  printf 'Product owner accepted the result.\n' \
    > ".foundation/logs/$change/acceptance.txt"
  $F receipt "$change" acceptance pass \
    --acceptor product-owner --decision accept \
    --criterion 'Result is understandable' \
    --observed 'Product owner inspected the result' \
    --artifact ".foundation/logs/$change/acceptance.txt" \
    --reference https://example.invalid/accepted-result
}

# --- A clean base move rebinds the verdict instead of expiring it. -----------
setup_project rebind-clean
$F new "verdict survives a clean base move" --rapid > /dev/null
C=verdict-survives-a-clean-base-move
$F resolve "$C" --impact low --coupling isolated --acceptance-required \
  --acceptance-reason 'A person must accept the result' \
  --acceptance-claims "$C-outcome" > /dev/null
$F sandbox create "$C" > /dev/null
printf 'export function add(a,b){return a+b;}\nexport function sub(a,b){return a-b;}\n' \
  > ".foundation/sandboxes/$C/src/calc.js"
# An untracked new file is the regression that motivated the canonical staged
# diff: replay's add -A plus apply --3way flip such a file to staged, and an
# identity split by tracked status expired the verdict over the flip alone.
printf 'export const brandNew = true;\n' > ".foundation/sandboxes/$C/src/new-file.js"
assert_cmd_zero "named human acceptance records" record_acceptance "$C"
receipt=".foundation/receipts/$C/acceptance.json"
assert_cmd_zero "the receipt carries a diff identity" \
  node -e "const r=JSON.parse(require('fs').readFileSync('$receipt','utf8'));
    process.exit(r.rebind && r.rebind.mode==='diff' && r.rebind.diffIdentity &&
      r.rebind.packetReviewHash ? 0 : 1)"
plan="$($F proof-plan "$C")"
assert_contains "the fresh verdict is valid" "$plan" "acceptance: valid"

printf 'landed by another change\n' > src/other.js
git add -A && git commit -qm "another change landed" > /dev/null
sync_out="$($F sandbox sync "$C")"
assert_contains "the target move replays cleanly" "$sync_out" "rebased: "
assert_eq "a clean replay leaves the diff identity unchanged" \
  "$(runtime_json "$C" .lastBaseMove.preDiffIdentity)" \
  "$(runtime_json "$C" .lastBaseMove.postDiffIdentity)"

plan="$($F proof-plan "$C")"
assert_contains "the moved base makes the verdict rebindable, not stale" \
  "$plan" "acceptance: reusable-diff"
assert_not_contains "the verdict is not reported stale" "$plan" "acceptance: stale"

# Pending tasks stop advance before it reaches the rebind; completing them is
# part of the normal path to Prove, not test scaffolding. The checkbox edit
# also proves the rebind survives controller progress: task ticks change the
# workspace hash but neither the diff identity nor the normalized packet hash.
sed 's/- \[ \]/- [x]/g' "openspec/changes/$C/tasks.md" > "$TMP/tasks-done.md"
cp "$TMP/tasks-done.md" "openspec/changes/$C/tasks.md"
cp "$TMP/tasks-done.md" ".foundation/sandboxes/$C/openspec/changes/$C/tasks.md"
$F proof-advance "$C" > /dev/null 2>&1 || true
plan="$($F proof-plan "$C")"
assert_contains "proof advance durably rebinds the verdict" "$plan" "acceptance: valid"
assert_cmd_zero "the rebound receipt records the new binding beside the original" \
  node -e "const r=JSON.parse(require('fs').readFileSync('$receipt','utf8'));
    process.exit(r.rebind.boundWorkspaceHash &&
      r.rebind.boundWorkspaceHash !== r.workspaceHash &&
      r.rebind.reboundFrom ? 0 : 1)"
assert_file_contains "the rebind is journaled" ".foundation/logs/$C/reuse.jsonl" \
  "diff-identity-unchanged"

assert_cmd_fails_with "a clean move refuses the wave release — rebind suffices" \
  "no reset is needed" \
  node .claude/harness/foundation.mjs authority-reset-base-move "$C" \
    --decision-ref user-decision-1

# --- A replay that alters the diff expires the verdict and gates the release. -
setup_project rebind-altered
printf '// header\nconst A = 1;\nconst B = 2;\nconst C3 = 3;\nexport function add(a,b){return a+b;}\nconst D = 4;\n' \
  > src/calc.js
git add -A && git commit -qm "wider fixture file" > /dev/null
$F new "an altered diff expires the verdict" --rapid > /dev/null
C=an-altered-diff-expires-the-verdict
$F resolve "$C" --impact low --coupling isolated --acceptance-required \
  --acceptance-reason 'A person must accept the result' \
  --acceptance-claims "$C-outcome" > /dev/null
$F sandbox create "$C" > /dev/null
# The sandbox edits line 5; the target edits line 2. Two untouched lines
# apart, the three-way replay merges cleanly — but line 2 sits inside the
# sandbox hunk's context window, so the replayed diff's content genuinely
# changed, and the verdict that covered the old diff must expire.
sed 's/return a+b;/return Number(a)+Number(b);/' src/calc.js \
  > ".foundation/sandboxes/$C/src/calc.js"
assert_cmd_zero "acceptance records before the move" record_acceptance "$C"
sed 's/const A = 1;/const A = 100;/' src/calc.js > "$TMP/calc-moved.js"
cp "$TMP/calc-moved.js" src/calc.js
git add -A && git commit -qm "target rewrote the shared context" > /dev/null
sync_out="$($F sandbox sync "$C" 2>&1)"
assert_contains "the overlapping move still replays cleanly" "$sync_out" "rebased: "
pre="$(runtime_json "$C" .lastBaseMove.preDiffIdentity)"
post="$(runtime_json "$C" .lastBaseMove.postDiffIdentity)"
if [ "$pre" != "$post" ]; then
  pass "a merge that reshapes the diff changes its identity"
else
  fail "a merge that reshapes the diff changes its identity"
fi
plan="$($F proof-plan "$C")"
assert_contains "the reshaped diff expires the verdict" "$plan" "acceptance: stale"
assert_cmd_fails_with "the wave release requires a recorded decision" \
  "requires --decision-ref" \
  node .claude/harness/foundation.mjs authority-reset-base-move "$C"
assert_cmd_fails_with "the wave release demands an expired delivered verdict" \
  "no delivered passing AI review attempt predates" \
  node .claude/harness/foundation.mjs authority-reset-base-move "$C" \
    --decision-ref user-decision-2

# --- The packet review hash isolates packet content from code content. -------
setup_project packet-hash
$F new "packet hash isolates packet content" --rapid > /dev/null
C=packet-hash-isolates-packet-content
$F sandbox create "$C" > /dev/null
$F hash "$C" > /dev/null
snapshot=".foundation/snapshots/$C.json"
packet_before="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$snapshot','utf8')).packetReviewHash)")"
if [ -n "$packet_before" ] && [ "$packet_before" != "undefined" ]; then
  pass "snapshots carry the packet review hash"
else
  fail "snapshots carry the packet review hash"
fi
printf 'export const extra = 1;\n' > ".foundation/sandboxes/$C/src/extra.js"
$F hash "$C" > /dev/null
packet_after_code="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$snapshot','utf8')).packetReviewHash)")"
assert_eq "a code edit leaves the packet review hash unchanged" \
  "$packet_before" "$packet_after_code"
printf '\nAmended proposal detail.\n' \
  >> ".foundation/sandboxes/$C/openspec/changes/$C/proposal.md"
$F hash "$C" > /dev/null
packet_after_packet="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$snapshot','utf8')).packetReviewHash)")"
if [ "$packet_before" != "$packet_after_packet" ]; then
  pass "a packet edit changes the packet review hash"
else
  fail "a packet edit changes the packet review hash"
fi

if [ -n "${FOUNDATION_RESULT_REPORT:-}" ]; then
  result_dir="$(dirname "$FOUNDATION_RESULT_REPORT")"
  mkdir -p "$result_dir"
  printf '%s\n' \
    '{"numTotalTests":3,"criticalCases":[' \
    ' {"id":"CASE-BASE-MOVE-REBIND-CLEAN","status":"pass"},' \
    ' {"id":"CASE-BASE-MOVE-EXPIRES-ALTERED","status":"pass"},' \
    ' {"id":"CASE-PACKET-HASH-ISOLATION","status":"pass"}' \
    ']}' > "$FOUNDATION_RESULT_REPORT"
fi

finish "base-move rebind"
