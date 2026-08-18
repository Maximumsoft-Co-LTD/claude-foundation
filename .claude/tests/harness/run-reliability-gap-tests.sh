#!/usr/bin/env sh
# Focused regressions for evidence input identity, copy reconciliation,
# repository relocation, runtime API consistency, and Claude session provenance.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

RESULT_REPORT="${FOUNDATION_RESULT_REPORT:-}"
case "$RESULT_REPORT" in
  ""|/*) ;;
  *) RESULT_REPORT="$ROOT/$RESULT_REPORT" ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

assert_cmd_zero "untracked command inputs have explicit coverage rules" \
  node --test "$ROOT/.claude/harness/tests/evidence-input-coverage.test.mjs"
assert_cmd_zero "copy apply accepts exact desired bytes and retains conflict guards" \
  node --test "$ROOT/.claude/tests/harness/run-apply-conflict-tests.mjs"
assert_cmd_zero "all shipped runtime API guidance matches executable pins" \
  node "$ROOT/.claude/tests/harness/run-single-source-tests.mjs"
assert_cmd_zero "Claude review retains exact fresh-session provenance" \
  node "$ROOT/.claude/harness/tests/configured-reviewer.test.mjs"
assert_cmd_zero "single-repository Build authority is independent of task count" \
  node --test "$ROOT/.claude/harness/tests/execution-graph.test.mjs"
assert_cmd_zero "standalone host entrypoints remain explicit in composition wiring" \
  sh "$ROOT/.claude/tests/harness/run-wiring-tests.sh"

setup_project() {
  project="$1"
  mkdir -p "$project/.claude" "$project/openspec"
  cp -R "$ROOT/.claude/harness" "$project/.claude/harness"
  cp -R "$ROOT/openspec/schemas" "$project/openspec/schemas"
  cp "$ROOT/openspec/config.yaml" "$project/openspec/config.yaml"
  cp "$ROOT/foundation.json" "$project/foundation.json"
}

INPUT_PROJECT="$TMP/provider-input-project"
setup_project "$INPUT_PROJECT"
cd "$INPUT_PROJECT"
F="node .claude/harness/foundation.mjs"
mkdir -p src tests
printf 'export const value = 1;\n' > src/value.mjs
printf 'console.log("ok");\n' > tests/run.mjs
$F new "provider input coverage" --rapid >/dev/null
INPUT_CHANGE=provider-input-coverage
$F resolve "$INPUT_CHANGE" --impact low --coupling isolated \
  --surface 'src/**' >/dev/null
cat > "openspec/changes/$INPUT_CHANGE/execution.yaml" <<'JSON'
{"version":1,"providers":{"test":{"adapter":"test-discovery","command":["node","tests/run.mjs"],"minimum":1,"reportFormat":"tap"}},"services":{}}
JSON
uncovered="$($F evidence-doctor "$INPUT_CHANGE" 2>&1 || true)"
assert_contains "validation names an uncovered untracked command file" "$uncovered" \
  "outside its inputs and declared surface: tests/run.mjs"
cat > "openspec/changes/$INPUT_CHANGE/execution.yaml" <<'JSON'
{"version":1,"providers":{"test":{"adapter":"test-discovery","command":["node","tests/run.mjs"],"minimum":1,"reportFormat":"tap","inputs":["src/**","tests/run.mjs"]}},"services":{}}
JSON
assert_cmd_zero "explicit provider inputs make the command wiring valid" \
  node .claude/harness/foundation.mjs evidence-doctor "$INPUT_CHANGE"
input_hash_before="$($F hash "$INPUT_CHANGE" test)"
printf 'console.log("changed");\n' > tests/run.mjs
input_hash_after="$($F hash "$INPUT_CHANGE" test)"
if [ "$input_hash_before" != "$input_hash_after" ]; then
  pass "changing the command script invalidates its provider identity"
else
  fail "changing the command script invalidates its provider identity"
fi

OLD="$TMP/old-project"
NEW="$TMP/new-project"
setup_project "$OLD"
cd "$OLD"
F="node .claude/harness/foundation.mjs"
$F new "relocated sandbox recovery" --rapid >/dev/null
C=relocated-sandbox-recovery
$F resolve "$C" --impact low --coupling isolated >/dev/null
$F sandbox create "$C" >/dev/null
recorded_old="$(node -e 'const s=require(process.argv[1]); console.log(s.workspace.path)' \
  "$OLD/.foundation/runtime/$C.json")"
cd "$TMP"
mv "$OLD" "$NEW"
cd "$NEW"
rebound="$($F sandbox create "$C")"
assert_contains "a moved project rebinds its canonical sandbox" "$rebound" "REBOUND $C"
recorded_new="$(node -e 'const s=require(process.argv[1]); console.log(s.workspace.path)' \
  "$NEW/.foundation/runtime/$C.json")"
canonical_new="$(node -e 'const {realpathSync}=require("node:fs"); console.log(realpathSync(process.argv[1]))' "$NEW")"
assert_eq "the runtime points at the relocated canonical sandbox" \
  "$canonical_new/.foundation/sandboxes/$C" "$recorded_new"
recorded_from="$(node -e 'const s=require(process.argv[1]); console.log(s.workspace.relocatedFrom)' \
  "$NEW/.foundation/runtime/$C.json")"
assert_eq "the recovery records the replaced locator" "$recorded_old" "$recorded_from"
assert_cmd_zero "packet generation resumes after rebind" \
  node .claude/harness/foundation.mjs packet "$C" --phase build

OLD_BAD="$TMP/old-mismatch"
NEW_BAD="$TMP/new-mismatch"
setup_project "$OLD_BAD"
cd "$OLD_BAD"
$F new "relocation mismatch stays blocked" --rapid >/dev/null
C_BAD=relocation-mismatch-stays-blocked
$F resolve "$C_BAD" --impact low --coupling isolated >/dev/null
$F sandbox create "$C_BAD" >/dev/null
old_bad_path="$(node -e 'const s=require(process.argv[1]); console.log(s.workspace.path)' \
  "$OLD_BAD/.foundation/runtime/$C_BAD.json")"
cd "$TMP"
mv "$OLD_BAD" "$NEW_BAD"
external_bad="$TMP/external-mismatch-sandbox"
mv "$NEW_BAD/.foundation/sandboxes/$C_BAD" "$external_bad"
ln -s "$external_bad" "$NEW_BAD/.foundation/sandboxes/$C_BAD"
cd "$NEW_BAD"
escaped="$($F sandbox create "$C_BAD" 2>&1 || true)"
assert_contains "a canonical sandbox symlink cannot escape the moved project" "$escaped" \
  "candidate escapes the canonical sandbox directory"
rm "$NEW_BAD/.foundation/sandboxes/$C_BAD"
mv "$external_bad" "$NEW_BAD/.foundation/sandboxes/$C_BAD"
printf 'mismatched change marker\n' > \
  "$NEW_BAD/.foundation/sandboxes/$C_BAD/openspec/changes/$C_BAD/.openspec.yaml"
rejected="$($F sandbox create "$C_BAD" 2>&1 || true)"
assert_contains "a mismatched canonical sandbox is rejected" "$rejected" \
  "change identity does not match '$C_BAD'"
still_old="$(node -e 'const s=require(process.argv[1]); console.log(s.workspace.path)' \
  "$NEW_BAD/.foundation/runtime/$C_BAD.json")"
assert_eq "a rejected rebind leaves runtime state unchanged" "$old_bad_path" "$still_old"

if [ -n "$RESULT_REPORT" ]; then
  mkdir -p "$(dirname "$RESULT_REPORT")"
  report_status=pass
  [ "$failures" -eq 0 ] || report_status=fail
  printf '%s\n' \
    '{"numTotalTests":7,"criticalCases":[' \
    " {\"id\":\"CASE-INPUT-BINDING\",\"status\":\"$report_status\"}," \
    " {\"id\":\"CASE-COPY-PREALIGNED\",\"status\":\"$report_status\"}," \
    " {\"id\":\"CASE-RELOCATION-REBIND\",\"status\":\"$report_status\"}," \
    " {\"id\":\"CASE-API-CONSISTENCY\",\"status\":\"$report_status\"}," \
    " {\"id\":\"CASE-CLAUDE-SESSION\",\"status\":\"$report_status\"}," \
    " {\"id\":\"CASE-SINGLE-REPO-BUILD-AUTHORITY\",\"status\":\"$report_status\"}," \
    " {\"id\":\"CASE-HOST-ENTRYPOINT-WIRING\",\"status\":\"$report_status\"}" \
    ']}' > "$RESULT_REPORT"
fi

finish "harness reliability gaps"
