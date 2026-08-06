#!/usr/bin/env sh
# run-specsync-gate-tests.sh — the post-archive spec-sync gate, as wired.
#
# spec-sync-verify.mjs is proved on its own inputs by
# run-spec-sync-verify-tests.mjs. What that suite cannot show is the wiring in
# apply-runtime's archive(): that the pre-merge spec text is captured BEFORE the
# destructive CLI step, that the archived result is re-read and checked after
# it, and that a violation stops Land with a record a human can repair instead
# of reporting a successful archive.
#
# The real 'openspec' CLI is never invoked. This reuses the PATH stub idiom from
# run-harness-tests.sh ("archive failure is surfaced after code apply"),
# extended with one env var: FOUNDATION_TEST_MERGED_SPECS names a directory of
# <capability>.md files the stub copies into openspec/specs/. The suite
# therefore decides exactly what the merge produced, so a corrupt merge is
# reproducible with no OpenSpec binary, no network, and no clock.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

assert_cmd_fails_with() {
  label="$1"; needle="$2"; shift 2
  output="$({ "$@"; } 2>&1 || true)"
  if [ -n "$output" ] && printf '%s' "$output" | grep -qF -- "$needle"; then
    pass "$label"
  else
    fail "$label — expected failure containing '$needle'"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec" "$TMP/bin" "$TMP/merged"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp -R "$ROOT/.claude/harness/runtime" "$TMP/project/.claude/harness/"
cp "$ROOT/.claude/harness/commands.json" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
printf 'initial\n' > "$TMP/project/app.txt"

# The stub stands in for 'openspec archive': it moves the change out of
# openspec/changes exactly as the real CLI does, and rewrites openspec/specs
# from whatever merge result the current scenario staged. Staging nothing means
# the merge left openspec/specs alone.
printf '%s\n' '#!/usr/bin/env sh' \
  'if [ "${1:-}" = "--version" ]; then echo "1.7.0"; exit 0; fi' \
  'if [ "${1:-}" = "archive" ]; then' \
  '  mkdir -p "openspec/changes/archive"' \
  '  mv "openspec/changes/$2" "openspec/changes/archive/$2"' \
  '  if [ -n "${FOUNDATION_TEST_MERGED_SPECS:-}" ]; then' \
  '    for merged in "$FOUNDATION_TEST_MERGED_SPECS"/*.md; do' \
  '      [ -f "$merged" ] || continue' \
  '      cap="$(basename "$merged" .md)"' \
  '      mkdir -p "openspec/specs/$cap"' \
  '      cp "$merged" "openspec/specs/$cap/spec.md"' \
  '    done' \
  '  fi' \
  '  echo "archived $2"' \
  '  exit 0' \
  'fi' > "$TMP/bin/openspec"
chmod +x "$TMP/bin/openspec"

cd "$TMP/project"

# Drive a created+resolved change from an isolated copy sandbox to a passing
# proof. Non-Git fixture, so the sandbox is a manifest-guarded copy.
prove_change() {
  _id="$1"; _file="$2"
  node .claude/harness/foundation.mjs sandbox create "$_id" >/dev/null
  _copy="$(jq -r '.workspace.path' ".foundation/runtime/$_id.json")"
  printf '%s\n' "$_id applied" > "$_copy/$_file"
  sed -i.bak 's/- \[ \]/- [x]/g' "$_copy/openspec/changes/$_id/tasks.md"
  rm "$_copy/openspec/changes/$_id/tasks.md.bak"
  node .claude/harness/foundation.mjs receipt "$_id" test pass \
    --observed "fixture test evidence" --source harness-test \
    --artifact app.txt >/dev/null
  node .claude/harness/foundation.mjs receipt "$_id" discovery pass \
    --discovered 1 --minimum 1 --observed "1 test discovered" \
    --source harness-test --artifact app.txt >/dev/null
  node .claude/harness/foundation.mjs prove "$_id" >/dev/null
}

# ---------------------------------------------------------------------------
# 1. A faithful merge archives, and records nothing to repair.
#
# 'appearance' already declares two requirements. The delta rewrites one of them
# and never mentions the other, which is the case invariant 4 watches: the
# untouched requirement has to survive byte-identical.
# ---------------------------------------------------------------------------
mkdir -p openspec/specs/appearance
printf '%s\n' \
  '# appearance Specification' '' '## Purpose' '' 'Fixture capability.' '' \
  '## Requirements' '' \
  '### Requirement: The theme is remembered' '' \
  'The system SHALL remember the theme.' '' \
  '#### Scenario: A theme survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the theme is kept' '' \
  '### Requirement: The banner is dismissible' '' \
  'The system SHALL let the banner stay dismissed.' '' \
  '#### Scenario: A dismissed banner stays dismissed' '' \
  '- **WHEN** the banner is dismissed' '- **THEN** it does not return' \
  > openspec/specs/appearance/spec.md

node .claude/harness/foundation.mjs new 'Spec sync clean' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve spec-sync-clean \
  --impact low --coupling isolated >/dev/null
mkdir -p openspec/changes/spec-sync-clean/specs/appearance
printf '%s\n' \
  '## MODIFIED Requirements' '' \
  '### Requirement: The theme is remembered' '' \
  'The system SHALL remember the theme across sessions.' '' \
  '#### Scenario: A theme survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the theme is kept' '' \
  '#### Scenario: A theme survives a new session' '' \
  '- **WHEN** a new session starts' '- **THEN** the theme is kept' \
  > openspec/changes/spec-sync-clean/specs/appearance/spec.md
printf '%s\n' \
  '# appearance Specification' '' '## Purpose' '' 'Fixture capability.' '' \
  '## Requirements' '' \
  '### Requirement: The theme is remembered' '' \
  'The system SHALL remember the theme across sessions.' '' \
  '#### Scenario: A theme survives a reload' '' \
  '- **WHEN** the page reloads' '- **THEN** the theme is kept' '' \
  '#### Scenario: A theme survives a new session' '' \
  '- **WHEN** a new session starts' '- **THEN** the theme is kept' '' \
  '### Requirement: The banner is dismissible' '' \
  'The system SHALL let the banner stay dismissed.' '' \
  '#### Scenario: A dismissed banner stays dismissed' '' \
  '- **WHEN** the banner is dismissed' '- **THEN** it does not return' \
  > "$TMP/merged/appearance.md"

prove_change spec-sync-clean feature-clean.txt
clean_archive="$({ PATH="$TMP/bin:$PATH" FOUNDATION_TEST_MERGED_SPECS="$TMP/merged" \
  node .claude/harness/foundation.mjs archive spec-sync-clean; } 2>&1 || true)"
assert_contains "a faithful merge archives" "$clean_archive" "ARCHIVED spec-sync-clean"
assert_eq "a faithful merge records no spec-sync violations" "false" \
  "$(jq -r 'has("specSyncViolations")' .foundation/runtime/spec-sync-clean.json)"
assert_eq "a faithful merge completes Land" "sandbox-cleaned" \
  "$(jq -r '.land.status' .foundation/runtime/spec-sync-clean.json)"
assert_file_contains "the merged spec carries the delta's new scenario" \
  openspec/specs/appearance/spec.md "A theme survives a new session"
# The captured pre-merge text is only worth keeping when there is something to
# re-verify. Storing it unconditionally would put a copy of every delta and every
# prior spec into every state file for no reader.
assert_eq "a faithful merge does not retain the captured pre-merge specs" "false" \
  "$(jq -r 'has("specSyncInputs")' .foundation/runtime/spec-sync-clean.json)"
rm -f "$TMP/merged/appearance.md"

# ---------------------------------------------------------------------------
# 2. A merge that does not match the delta fails Land, names what broke, and
#    leaves the finding on disk.
#
# Two independent corruptions in one merge: a scenario the MODIFIED block
# declared never arrives, and a requirement the delta never mentioned is
# deleted. Both exit 0 from the CLI, which is why the exit code is not evidence.
# ---------------------------------------------------------------------------
mkdir -p openspec/specs/layout
printf '%s\n' \
  '# layout Specification' '' '## Purpose' '' 'Fixture capability.' '' \
  '## Requirements' '' \
  '### Requirement: The grid is responsive' '' \
  'The system SHALL reflow the grid.' '' \
  '#### Scenario: A grid reflows on a narrow screen' '' \
  '- **WHEN** the viewport narrows' '- **THEN** the grid reflows' '' \
  '### Requirement: The footer is sticky' '' \
  'The system SHALL keep the footer visible.' '' \
  '#### Scenario: A footer stays visible while scrolling' '' \
  '- **WHEN** the page scrolls' '- **THEN** the footer stays visible' \
  > openspec/specs/layout/spec.md

node .claude/harness/foundation.mjs new 'Spec sync corrupt' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve spec-sync-corrupt \
  --impact low --coupling isolated >/dev/null
mkdir -p openspec/changes/spec-sync-corrupt/specs/layout
printf '%s\n' \
  '## MODIFIED Requirements' '' \
  '### Requirement: The grid is responsive' '' \
  'The system SHALL reflow the grid at every breakpoint.' '' \
  '#### Scenario: A grid reflows on a narrow screen' '' \
  '- **WHEN** the viewport narrows' '- **THEN** the grid reflows' '' \
  '#### Scenario: A grid reflows on a wide screen' '' \
  '- **WHEN** the viewport widens' '- **THEN** the grid reflows' \
  > openspec/changes/spec-sync-corrupt/specs/layout/spec.md
printf '%s\n' \
  '# layout Specification' '' '## Purpose' '' 'Fixture capability.' '' \
  '## Requirements' '' \
  '### Requirement: The grid is responsive' '' \
  'The system SHALL reflow the grid at every breakpoint.' '' \
  '#### Scenario: A grid reflows on a narrow screen' '' \
  '- **WHEN** the viewport narrows' '- **THEN** the grid reflows' \
  > "$TMP/merged/layout.md"

prove_change spec-sync-corrupt feature-corrupt.txt
corrupt_archive="$({ PATH="$TMP/bin:$PATH" FOUNDATION_TEST_MERGED_SPECS="$TMP/merged" \
  node .claude/harness/foundation.mjs archive spec-sync-corrupt; } 2>&1 || true)"
assert_contains "a merge that contradicts the delta fails Land" \
  "$corrupt_archive" "archived specs do not match the change delta"
assert_not_contains "a failed spec sync does not report a successful archive" \
  "$corrupt_archive" "ARCHIVED spec-sync-corrupt"
assert_contains "the failure names the capability and the modified requirement" \
  "$corrupt_archive" "layout/The grid is responsive"
assert_contains "the failure names the scenario the merge dropped" \
  "$corrupt_archive" "A grid reflows on a wide screen"
assert_contains "the failure names collateral damage to an untouched requirement" \
  "$corrupt_archive" "layout/The footer is sticky"

corrupt_state=.foundation/runtime/spec-sync-corrupt.json
assert_eq "the violations are persisted for repair" "2" \
  "$(jq -r '.specSyncViolations | length' "$corrupt_state")"
assert_eq "each persisted violation carries capability, kind, and requirement" \
  "layout/modified-scenario-missing/The grid is responsive layout/untouched-requirement-missing/The footer is sticky" \
  "$(jq -r '[.specSyncViolations[] | "\(.capability)/\(.kind)/\(.requirement)"] | sort | join(" ")' \
    "$corrupt_state")"
assert_cmd_zero "each persisted violation carries a human-readable detail" \
  jq -e 'all(.specSyncViolations[]; (.detail | type) == "string" and (.detail | length) > 0)' \
  "$corrupt_state"
# The CLI already moved the change and rewrote the spec, so the gate can only
# refuse to certify the result — the archive itself is not undone. Land stops at
# specs-archived rather than advancing, which is what keeps a retry honest.
assert_eq "the refused archive stops before Land's audited state" "specs-archived" \
  "$(jq -r '.land.status' "$corrupt_state")"
# The pre-merge text is what lets the retry guard re-derive the answer instead of
# trusting a stored flag.
assert_eq "the refused archive retains the captured pre-merge specs" "1" \
  "$(jq -r '.specSyncInputs | length' "$corrupt_state")"
assert_eq "the captured input names the capability it was read from" "layout" \
  "$(jq -r '.specSyncInputs[0].capability' "$corrupt_state")"

# 2a. The retry is refused too.
#
# The gate can only fire once the change is already recorded archived, so the
# retry lands on the 'already archived' early return. Before the guard existed
# that path reported ALREADY ARCHIVED, ran cleanup, advanced Land to
# sandbox-cleaned, and exited 0 — one retry laundered a corrupt spec tree into a
# clean landing.
retry_archive="$({ PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs \
  archive spec-sync-corrupt; } 2>&1 || true)"
assert_contains "a retry over an unrepaired spec tree is refused" \
  "$retry_archive" "archived specs do not match the change delta"
assert_contains "the retry repeats the specific violation" \
  "$retry_archive" "layout/The grid is responsive"
assert_not_contains "the retry does not report the change as archived" \
  "$retry_archive" "ARCHIVED spec-sync-corrupt"
assert_eq "the retry does not advance Land" "specs-archived" \
  "$(jq -r '.land.status' "$corrupt_state")"
assert_eq "the retry does not clear the violations" "2" \
  "$(jq -r '.specSyncViolations | length' "$corrupt_state")"

# 2b. Repairing the spec tree clears the block.
#
# The guard re-runs the checker against the captured inputs and the CURRENT
# spec tree rather than reading the stored flag, so the way out is to fix the
# actual file. Nobody hand-edits runtime JSON, which orchestrator.md forbids.
# 'The footer is sticky' is restored verbatim: invariant 4 compares the body of
# an unmentioned requirement byte for byte.
printf '%s\n' \
  '# layout Specification' '' '## Purpose' '' 'Fixture capability.' '' \
  '## Requirements' '' \
  '### Requirement: The grid is responsive' '' \
  'The system SHALL reflow the grid at every breakpoint.' '' \
  '#### Scenario: A grid reflows on a narrow screen' '' \
  '- **WHEN** the viewport narrows' '- **THEN** the grid reflows' '' \
  '#### Scenario: A grid reflows on a wide screen' '' \
  '- **WHEN** the viewport widens' '- **THEN** the grid reflows' '' \
  '### Requirement: The footer is sticky' '' \
  'The system SHALL keep the footer visible.' '' \
  '#### Scenario: A footer stays visible while scrolling' '' \
  '- **WHEN** the page scrolls' '- **THEN** the footer stays visible' \
  > openspec/specs/layout/spec.md
repaired_archive="$({ PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs \
  archive spec-sync-corrupt; } 2>&1 || true)"
assert_not_contains "a repaired spec tree stops being refused" \
  "$repaired_archive" "archived specs do not match the change delta"
assert_contains "a repaired spec tree lands" \
  "$repaired_archive" "ALREADY ARCHIVED spec-sync-corrupt"
assert_eq "repair clears the recorded violations" "false" \
  "$(jq -r 'has("specSyncViolations")' "$corrupt_state")"
assert_eq "repair clears the captured pre-merge specs" "false" \
  "$(jq -r 'has("specSyncInputs")' "$corrupt_state")"
assert_eq "repair lets Land finish" "sandbox-cleaned" \
  "$(jq -r '.land.status' "$corrupt_state")"
rm -f "$TMP/merged/layout.md"

# ---------------------------------------------------------------------------
# 3. A change with no spec capabilities archives untouched.
#
# Two separate absences, because each is guarded separately: a change with no
# 'specs/' directory at all, and a change whose 'specs/' holds a directory with
# no spec.md in it. Capture must skip both rather than read a file that is not
# there.
# ---------------------------------------------------------------------------
node .claude/harness/foundation.mjs new 'Spec sync none' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve spec-sync-none \
  --impact low --coupling isolated >/dev/null
assert_file_absent "the change declares no specs directory" \
  openspec/changes/spec-sync-none/specs

prove_change spec-sync-none feature-none.txt
cp openspec/specs/appearance/spec.md "$TMP/appearance-before.md"
none_archive="$({ PATH="$TMP/bin:$PATH" \
  node .claude/harness/foundation.mjs archive spec-sync-none; } 2>&1 || true)"
assert_contains "a change with no specs directory archives" "$none_archive" \
  "ARCHIVED spec-sync-none"
assert_eq "a change with no specs directory records no violations" "false" \
  "$(jq -r 'has("specSyncViolations")' .foundation/runtime/spec-sync-none.json)"

node .claude/harness/foundation.mjs new 'Spec sync orphan specs' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve spec-sync-orphan-specs \
  --impact low --coupling isolated >/dev/null
mkdir -p openspec/changes/spec-sync-orphan-specs/specs/notes
printf '%s\n' 'Not a capability delta.' \
  > openspec/changes/spec-sync-orphan-specs/specs/notes/README.md

prove_change spec-sync-orphan-specs feature-orphan.txt
orphan_archive="$({ PATH="$TMP/bin:$PATH" \
  node .claude/harness/foundation.mjs archive spec-sync-orphan-specs; } 2>&1 || true)"
assert_contains "a directory under specs/ without a spec.md is not a capability" \
  "$orphan_archive" "ARCHIVED spec-sync-orphan-specs"
assert_eq "an orphan specs directory records no violations" "false" \
  "$(jq -r 'has("specSyncViolations")' .foundation/runtime/spec-sync-orphan-specs.json)"
assert_cmd_zero "a change with no capability delta leaves openspec/specs alone" \
  cmp -s "$TMP/appearance-before.md" openspec/specs/appearance/spec.md

# ---------------------------------------------------------------------------
# 4. A brand-new capability has no 'before' spec on disk.
#
# currentSpecText returns null for it, so the checker has to accept a null
# 'before' rather than fail reading it.
# ---------------------------------------------------------------------------
node .claude/harness/foundation.mjs new 'Spec sync new capability' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve spec-sync-new-capability \
  --impact low --coupling isolated >/dev/null
mkdir -p openspec/changes/spec-sync-new-capability/specs/telemetry
printf '%s\n' \
  '## ADDED Requirements' '' \
  '### Requirement: Events are recorded' '' \
  'The system SHALL record every event once.' '' \
  '#### Scenario: An event is recorded once' '' \
  '- **WHEN** an event occurs' '- **THEN** it is recorded exactly once' \
  > openspec/changes/spec-sync-new-capability/specs/telemetry/spec.md
printf '%s\n' \
  '# telemetry Specification' '' '## Purpose' '' 'Fixture capability.' '' \
  '## Requirements' '' \
  '### Requirement: Events are recorded' '' \
  'The system SHALL record every event once.' '' \
  '#### Scenario: An event is recorded once' '' \
  '- **WHEN** an event occurs' '- **THEN** it is recorded exactly once' \
  > "$TMP/merged/telemetry.md"

prove_change spec-sync-new-capability feature-new.txt
assert_file_absent "the new capability has no spec before archive" \
  openspec/specs/telemetry/spec.md
new_capability_archive="$({ PATH="$TMP/bin:$PATH" \
  FOUNDATION_TEST_MERGED_SPECS="$TMP/merged" \
  node .claude/harness/foundation.mjs archive spec-sync-new-capability; } 2>&1 || true)"
assert_contains "a brand-new capability archives without a 'before' spec" \
  "$new_capability_archive" "ARCHIVED spec-sync-new-capability"
assert_eq "a brand-new capability records no violations" "false" \
  "$(jq -r 'has("specSyncViolations")' \
    .foundation/runtime/spec-sync-new-capability.json)"
assert_file_exists "the new capability spec is created by archive" \
  openspec/specs/telemetry/spec.md
rm -f "$TMP/merged/telemetry.md"

# A brand-new capability the merge never wrote is the same class of silent loss
# as a dropped requirement, and must be caught rather than read as "nothing to
# compare against".
node .claude/harness/foundation.mjs new 'Spec sync new capability dropped' --rapid >/dev/null
node .claude/harness/foundation.mjs resolve spec-sync-new-capability-dropped \
  --impact low --coupling isolated >/dev/null
mkdir -p openspec/changes/spec-sync-new-capability-dropped/specs/pricing
printf '%s\n' \
  '## ADDED Requirements' '' \
  '### Requirement: Prices are shown with tax' '' \
  'The system SHALL show prices with tax.' '' \
  '#### Scenario: A price includes tax' '' \
  '- **WHEN** a price is rendered' '- **THEN** tax is included' \
  > openspec/changes/spec-sync-new-capability-dropped/specs/pricing/spec.md

prove_change spec-sync-new-capability-dropped feature-dropped.txt
dropped_archive="$({ PATH="$TMP/bin:$PATH" node .claude/harness/foundation.mjs \
  archive spec-sync-new-capability-dropped; } 2>&1 || true)"
assert_contains "a new capability the merge never wrote fails Land" \
  "$dropped_archive" "pricing/Prices are shown with tax"
assert_eq "the dropped new capability is persisted for repair" \
  "added-requirement-missing" \
  "$(jq -r '.specSyncViolations[0].kind' \
    .foundation/runtime/spec-sync-new-capability-dropped.json)"

finish "spec-sync gate"
