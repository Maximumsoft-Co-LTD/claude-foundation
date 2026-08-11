#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"
. "$ROOT/.claude/tests/lib/harness-fixture.sh"

assert_cmd_fails_with() {
  label="$1"; needle="$2"; shift 2
  output="$({ "$@"; } 2>&1 || true)"
  if [ -n "$output" ] && printf '%s' "$output" | grep -qF -- "$needle"; then
    pass "$label"
  else
    fail "$label — expected failure containing '$needle'"
  fi
}

assert_cmd_zero "benchmark targets are valid JSON" \
  jq -e '.workflow == "openspec-native" and .scenarios["todolist-r2"].target.task_mirror_operations_max == 0' \
  "$ROOT/.claude/tests/bench/config/openspec-native-targets.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
install_harness_fixture "$ROOT" "$TMP/project"
cp "$ROOT/.claude/harness/commands.json" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
printf 'initial\n' > "$TMP/project/app.txt"

cd "$TMP/project"

providers="$(node .claude/harness/foundation.mjs providers)"
assert_contains "provider catalog includes static analysis" "$providers" "static-analysis"
assert_contains "provider catalog includes data migration" "$providers" "data-migration"
assert_contains "provider catalog includes accessibility" "$providers" "accessibility"
assert_contains "provider catalog includes resilience" "$providers" "resilience"
assert_contains "provider catalog includes observability" "$providers" "observability"
assert_contains "provider catalog includes deployment" "$providers" "deployment"
assert_contains "provider catalog includes supply chain" "$providers" "dependency-supply-chain"
assert_contains "provider catalog exposes executable test wiring" "$providers" \
  'CONFIG test-discovery'
assert_contains "test wiring names the structured report field" "$providers" \
  'workspace-relative-structured-json-report'

# Domain slices share this fixture process deliberately: assertion order,
# mutable fixture state, and the aggregate result remain the same contract this
# runner exposed before the split.
. "$HERE/contracts/change-policy.sh"
. "$HERE/contracts/evidence-proof.sh"
. "$HERE/contracts/sandbox-land.sh"
. "$HERE/contracts/multi-repository.sh"
. "$HERE/contracts/planning-diagnostics.sh"
