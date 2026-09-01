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

assert_cmd_zero "cross-domain benchmark matrix is valid" \
  node "$ROOT/.claude/tests/bench/openspec-native/matrix.mjs"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
install_harness_fixture "$ROOT" "$TMP/project"
cp "$ROOT/.claude/harness/commands.json" "$TMP/project/.claude/harness/"
# `describe` reads the change-loop descriptions from the shipped command files
# rather than keeping a second copy in commands.json. They are MANAGED, so a
# real install always has them; the fixture has to carry them too.
cp -R "$ROOT/.claude/commands" "$TMP/project/.claude/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
printf 'initial\n' > "$TMP/project/app.txt"

# Evidence contracts exercise receipt binding, execution, and proof lifecycle;
# they do not exercise the no-git fallback (that has dedicated surface and
# sandbox coverage). Give this slice the same indexed baseline a real project
# has. Without it every lifecycle command must byte-hash the copied harness
# again, and the growing fixture turns 163 small CLI assertions into a
# multi-minute serial tail in run-all.
if [ "$#" -eq 1 ] && { [ "$1" = "evidence-proof" ] ||
   [ "$1" = "evidence-proof-a" ] || [ "$1" = "evidence-proof-a1" ] ||
   [ "$1" = "evidence-proof-a2" ] || [ "$1" = "evidence-proof-b" ] ||
   [ "$1" = "evidence-proof-c" ] ||
   [ "${1#evidence-proof-a1-}" != "$1" ] ||
   [ "${1#evidence-proof-a2-}" != "$1" ] ||
   [ "${1#evidence-proof-b-}" != "$1" ] ||
   [ "${1#evidence-proof-c-}" != "$1" ]; }; then
  git init -q "$TMP/project"
  git -C "$TMP/project" add .
  git -C "$TMP/project" \
    -c user.name='Foundation Tests' -c user.email='foundation@example.invalid' \
    commit -qm 'fixture baseline'
fi

cd "$TMP/project"

# The contracts below attribute telemetry to run ids they choose themselves.
# `event` falls back to the ambient host session when no --run is given, so a
# real Claude or Codex session running this suite would re-attribute fixture
# events to its own identity and leave the window assertions reading a run
# nobody recorded against. Cases that need a bound session still set one inline.
unset FOUNDATION_CLAUDE_SESSION_ID FOUNDATION_CLAUDE_TRANSCRIPT_PATH
unset FOUNDATION_RUN_ID FOUNDATION_SESSION_ID CODEX_THREAD_ID

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
#
# Arguments select slices so independent slices can run as parallel suites and
# a mutation kill can target the slice that owns the detecting assertion. No
# arguments runs all five — the original aggregate contract. The only
# cross-slice state is `cross-repository-profile`, created by multi-repository
# and read by planning-diagnostics: a run selecting planning-diagnostics must
# select multi-repository before it, and `run-all.sh` schedules them together.
slices="${*:-change-policy evidence-proof sandbox-land multi-repository planning-diagnostics}"
for slice in $slices; do
  case "$slice" in
    change-policy|evidence-proof|evidence-proof-a|evidence-proof-a1|evidence-proof-a1-ci|evidence-proof-a1-core|evidence-proof-a2|evidence-proof-a2-review|evidence-proof-a2-recovery|evidence-proof-a2-cache|evidence-proof-b|evidence-proof-b-binding|evidence-proof-b-execution|evidence-proof-b-service|evidence-proof-c|evidence-proof-c-browser|evidence-proof-c-telemetry|evidence-proof-c-waive|sandbox-land|multi-repository|planning-diagnostics) ;;
    *) echo "unknown contract slice: $slice" >&2; exit 2 ;;
  esac
done
for slice in $slices; do
  case "$slice" in
    evidence-proof-a|evidence-proof-a1|evidence-proof-a1-ci|evidence-proof-a1-core|evidence-proof-a2|evidence-proof-a2-review|evidence-proof-a2-recovery|evidence-proof-a2-cache|evidence-proof-b|evidence-proof-b-binding|evidence-proof-b-execution|evidence-proof-b-service|evidence-proof-c|evidence-proof-c-browser|evidence-proof-c-telemetry|evidence-proof-c-waive)
      FOUNDATION_EVIDENCE_PROOF_SHARD="${slice#evidence-proof-}"
      export FOUNDATION_EVIDENCE_PROOF_SHARD
      . "$HERE/contracts/evidence-proof.sh"
      unset FOUNDATION_EVIDENCE_PROOF_SHARD
      ;;
    *) . "$HERE/contracts/$slice.sh" ;;
  esac
done

# The summary lives here, not in the last slice, so a partial selection still
# fails the run when any assertion failed.
finish "harness contracts"
