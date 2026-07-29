#!/usr/bin/env sh
# run-artifact-lint-tests.sh — fixtures-based test suite for artifact-lint.sh.
#
# The two load-bearing assertions (the spec's AC6) drive off the COMMITTED
# fixtures:
#   - exits 0     on the clean  pass/ fixture
#   - exits non-0 on the broken fail/ fixture (missing section + placeholder)
#
# The remaining assertions map each acceptance criterion (AC1–AC5, plus AC7 for
# the test-plan.md required-section rule) to a focused behaviour check, built from
# throwaway temp fixtures so the committed fixtures stay minimal. Every assertion
# is one suite run; the suite runs in this single process. Paths are resolved
# relative to THIS script's location, so the runner is invariant to the caller's
# working directory. Exit 0 iff every assertion holds.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
LINTER="$HERE/../artifact-lint.sh"
PASS_DIR="$HERE/fixtures/pass/.workflow/0000-feat-sample"
FAIL_DIR="$HERE/fixtures/fail/.workflow/0000-feat-broken"

if [ ! -f "$LINTER" ]; then
  echo "FAIL: linter not found at $LINTER" >&2
  exit 1
fi

failures=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT INT TERM

# run_lint <dir> -> prints nothing, returns the linter's exit code.
run_lint() {
  set +e
  sh "$LINTER" "$1" >/dev/null 2>&1
  rc=$?
  set -e
  return "$rc"
}

# Run the linter and CAPTURE its report (stdout+stderr) for content assertions.
run_lint_out() {
  set +e
  out="$(sh "$LINTER" "$1" 2>&1)"
  rc=$?
  set -e
}

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; failures=$((failures + 1)); }

# assert_exit_zero <label> <dir>
assert_exit_zero() {
  if run_lint "$2"; then pass "$1 (exit 0)"; else fail "$1 — expected exit 0, got $?"; fi
}
# assert_exit_nonzero <label> <dir>
assert_exit_nonzero() {
  if run_lint "$2"; then fail "$1 — expected non-zero, got 0"; else pass "$1 (exit non-zero)"; fi
}
# assert_report_contains <label> <dir> <substring>
assert_report_contains() {
  run_lint_out "$2"
  if printf '%s' "$out" | grep -qF -- "$3"; then
    pass "$1 (report names: $3)"
  else
    fail "$1 — report missing '$3'. Got: $out"
  fi
}

# --- helpers to build temp run dirs ---
mk_clean_spec() { printf '# Spec\n\n**Type**: feat\n\n## Goal\nShip X for Y.\n\n## User Stories\n- [x] AC1: ok\n' > "$1/spec.md"; }
mk_clean_plan() { printf '# Plan\n\n## Architecture diagram\n```mermaid\nflowchart LR\nA-->B\n```\n' > "$1/plan.md"; }
mk_clean_tasks() { printf '# Tasks\n\n## Phase 1\n- [x] T001 [AC1] do — verify: x\n' > "$1/tasks.md"; }

echo "Running artifact-lint test suite..."
echo

# AC6 — the brief's required committed-fixture assertions.
assert_exit_zero    "AC6 pass-fixture"  "$PASS_DIR"
assert_exit_nonzero "AC6 fail-fixture"  "$FAIL_DIR"
assert_report_contains "AC6 fail-fixture report" "$FAIL_DIR" "MISSING required section: User Stories"
assert_report_contains "AC6 fail-fixture report" "$FAIL_DIR" "placeholder marker"

# AC1 — a fully clean run dir exits 0; a dir with no recognised artifact fails.
d="$TMPROOT/ac1-clean"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"; mk_clean_tasks "$d"
assert_exit_zero "AC1 clean dir" "$d"
d="$TMPROOT/ac1-noart"; mkdir -p "$d"; echo '{}' > "$d/state.json"
assert_exit_nonzero "AC1 no recognised artifact" "$d"
assert_report_contains "AC1 no-artifact message" "$d" "no lintable artifacts found"

# AC2 — spec missing the User Stories section is named + fails.
d="$TMPROOT/ac2"; mkdir -p "$d"; printf '# Spec\n\n**Type**: feat\n\n## Goal\ng\n\n## Summary\nx\n' > "$d/spec.md"
assert_exit_nonzero "AC2 spec missing User Stories" "$d"
assert_report_contains "AC2 names missing section" "$d" "MISSING required section: User Stories"
# spec missing Type is named too.
d="$TMPROOT/ac2b"; mkdir -p "$d"; printf '# Spec\n\n## Goal\ng\n\n## User Stories\n- [x] AC1\n' > "$d/spec.md"
assert_report_contains "AC2 names missing Type" "$d" "MISSING required section: Type declaration"
# spec missing the Goal section is named + fails.
d="$TMPROOT/ac2-goal"; mkdir -p "$d"; printf '# Spec\n\n**Type**: feat\n\n## User Stories\n- [x] AC1\n' > "$d/spec.md"
assert_exit_nonzero "AC2 spec missing Goal" "$d"
assert_report_contains "AC2 names missing Goal" "$d" "MISSING required section: Goal"

# AC3 — plan missing its mermaid; tasks missing AC tag + verify, each named + fails.
d="$TMPROOT/ac3"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_tasks "$d"
printf '# Plan\n\n## Summary\nno diagram here\n' > "$d/plan.md"
assert_exit_nonzero "AC3 plan missing mermaid" "$d"
assert_report_contains "AC3 names missing mermaid" "$d" "MISSING required section: mermaid diagram"
d="$TMPROOT/ac3-tasks"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"
printf '# Tasks\n\n## Phase 1\n- [ ] T001 do something\n' > "$d/tasks.md"
assert_report_contains "AC3 names missing AC tag in tasks" "$d" "MISSING required section: inline AC tag"
assert_report_contains "AC3 names missing verify in tasks" "$d" "MISSING required section: runnable verify section"

# AC4 — placeholder markers (word + angle) reported with line numbers; fenced/backticked ignored.
d="$TMPROOT/ac4"; mkdir -p "$d"; mk_clean_plan "$d"
printf '# Spec\n\n**Type**: feat\n\n## Goal\ng\n\n## User Stories\n- [x] AC1\n- TODO finish\n- handle <id>\n- lorem ipsum\n- FIXME this\n' > "$d/spec.md"
assert_exit_nonzero "AC4 placeholders present" "$d"
assert_report_contains "AC4 reports TODO" "$d" "placeholder marker: TODO"
assert_report_contains "AC4 reports angle"  "$d" "placeholder marker: <...>"
assert_report_contains "AC4 reports lorem"  "$d" "placeholder marker: lorem"
assert_report_contains "AC4 reports FIXME"  "$d" "placeholder marker: FIXME"
# code-span + fence exclusion: documented markers do NOT fail.
d="$TMPROOT/ac4-doc"; mkdir -p "$d"; mk_clean_plan "$d"
printf '# Spec\n\n**Type**: feat\n\n## Goal\nclean goal line\n\n## User Stories\n- [x] AC1: we document `TODO` and `<id>` here\n```\nTODO inside a fence is ignored\n```\n' > "$d/spec.md"
assert_exit_zero "AC4 documented markers ignored" "$d"

# AC5 — usage / not-a-directory / empty-directory all fail.
assert_exit_nonzero "AC5 nonexistent path" "/no/such/path/xyz"
d="$TMPROOT/ac5-empty"; mkdir -p "$d"
assert_exit_nonzero "AC5 empty dir" "$d"
assert_report_contains "AC5 empty-dir message" "$d" "directory is empty"
# missing arg (run linter with zero args) — separate, since run_lint passes one.
set +e
sh "$LINTER" >/dev/null 2>&1; rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "AC5 missing arg (exit non-zero)"; else fail "AC5 missing arg — expected non-zero"; fi

# AC7 — test-plan.md required sections: a `## Coverage plan` heading AND an AC reference.
mk_clean_test_plan() { printf '# Test plan\n\n## Coverage plan\n| AC | Level | Asserts |\n|----|-------|---------|\n| AC1 | unit | ok |\n' > "$1/test-plan.md"; }
d="$TMPROOT/ac7-clean"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"; mk_clean_test_plan "$d"
assert_exit_zero "AC7 clean test-plan" "$d"
# missing Coverage plan section is named + fails.
d="$TMPROOT/ac7-nocov"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"
printf '# Test plan\n\n## Fixtures\nAC1 is mapped somewhere\n' > "$d/test-plan.md"
assert_exit_nonzero "AC7 test-plan missing coverage plan" "$d"
assert_report_contains "AC7 names missing coverage plan" "$d" "MISSING required section: Coverage plan"
# missing AC reference is named + fails.
d="$TMPROOT/ac7-noac"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"
printf '# Test plan\n\n## Coverage plan\n| level | asserts |\n|-------|---------|\n| unit | ok |\n' > "$d/test-plan.md"
assert_exit_nonzero "AC7 test-plan missing AC ref" "$d"
assert_report_contains "AC7 names missing AC ref" "$d" "MISSING required section: AC reference"

# AC8 — FOLLOWUPS.md governance: duplicate IDs + a consumed row left in ## Open.
# The check finds FOLLOWUPS.md in the run dir or one level up; here we drop it in
# the run dir directly. A clean backlog (distinct IDs, consumed rows in Closed)
# passes; a duplicate row-ID or a consumed-by row still in Open fails.
mk_clean_followups() { printf '# Follow-ups\n\n## Open\n| ID | Item |\n|----|------|\n| F-0001-feat-x-01 | do a thing |\n| F0002 | legacy item |\n\n## Closed\n| ID | Item | Status |\n|----|------|--------|\n| F-0001-feat-x-02 | done thing | consumed-by: 0003-feat-y |\n' > "$1/FOLLOWUPS.md"; }
d="$TMPROOT/ac8-clean"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"; mk_clean_followups "$d"
assert_exit_zero "AC8 clean FOLLOWUPS" "$d"
# duplicate ID across two Open rows.
d="$TMPROOT/ac8-dup"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"
printf '# Follow-ups\n\n## Open\n| ID | Item |\n|----|------|\n| F0031 | first |\n| F0031 | collided |\n' > "$d/FOLLOWUPS.md"
assert_exit_nonzero "AC8 duplicate ID" "$d"
assert_report_contains "AC8 names duplicate ID" "$d" "duplicate follow-up ID across rows: F0031"
# a consumed-by row left in the Open section (should have moved to Closed).
d="$TMPROOT/ac8-openconsumed"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"
printf '# Follow-ups\n\n## Open\n| ID | Item | Status |\n|----|------|--------|\n| F-0005-fix-z-01 | leaked | consumed-by: 0006-feat-w |\n' > "$d/FOLLOWUPS.md"
assert_exit_nonzero "AC8 consumed row left in Open" "$d"
assert_report_contains "AC8 names consumed-in-open" "$d" "left in ## Open"

# AC9 — hook adapter (`--hook`): warn-only PostToolUse mode. Emits an
# additionalContext JSON note for a dirty artifact, stays silent for a clean
# one, a non-artifact path, and _templates — and always exits 0. Needs jq
# (the adapter fails open without it), so skip the block when jq is absent.
if command -v jq >/dev/null 2>&1; then
  run_hook() {  # $1 = file_path to report; captures $out/$rc
    set +e
    out="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$1" | sh "$LINTER" --hook 2>&1)"
    rc=$?
    set -e
  }
  d="$TMPROOT/ac9/.workflow/0009-feat-h"; mkdir -p "$d"
  printf '# Spec\n\n**Type**: feat\n\n## Goal\nTODO fill this in\n\n## User Stories\n- s\n' > "$d/spec.md"
  run_hook "$d/spec.md"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'additionalContext'; then pass "AC9 hook warns on dirty artifact (exit 0)"; else fail "AC9 hook warns on dirty artifact"; fi
  mk_clean_spec "$d"
  run_hook "$d/spec.md"
  if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "AC9 hook silent on clean artifact"; else fail "AC9 hook silent on clean artifact"; fi
  printf '{}\n' > "$d/state.json"
  run_hook "$d/state.json"
  if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "AC9 hook skips non-artifact file"; else fail "AC9 hook skips non-artifact file"; fi
  t="$TMPROOT/ac9/.workflow/_templates"; mkdir -p "$t"
  printf '# Spec\n\n**Type**: <type>\nTODO\n' > "$t/spec.md"
  run_hook "$t/spec.md"
  if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "AC9 hook skips _templates"; else fail "AC9 hook skips _templates"; fi
else
  echo "SKIP: AC9 hook adapter tests (jq not installed)"
fi

# AC10 — type-aware shapes: each non-feat type passes with its own contract
# block (no User Stories) and fails without it; the non-feat block must carry
# an AC id; chore/docs plans are exempt from the mermaid requirement.
mk_typed_spec() {  # $1=dir $2=type $3=contract-block heading
  printf '# Spec\n\n**Type**: %s\n\n## Goal\ng\n\n## %s\n\n- [x] AC1 ok\n' "$2" "$3" > "$1/spec.md"
}
d="$TMPROOT/ac10-fix"; mkdir -p "$d"; mk_typed_spec "$d" fix "Reproduction & Expected"; mk_clean_plan "$d"; mk_clean_tasks "$d"
assert_exit_zero "AC10 fix spec passes without User Stories" "$d"
d="$TMPROOT/ac10-fix-miss"; mkdir -p "$d"; mk_typed_spec "$d" fix "Wrong section"
assert_exit_nonzero "AC10 fix spec missing Reproduction" "$d"
assert_report_contains "AC10 names Reproduction" "$d" "MISSING required section: Reproduction & Expected (fix)"
d="$TMPROOT/ac10-refactor"; mkdir -p "$d"; mk_typed_spec "$d" refactor "Equivalence contract"; mk_clean_plan "$d"; mk_clean_tasks "$d"
assert_exit_zero "AC10 refactor spec passes" "$d"
d="$TMPROOT/ac10-spike"; mkdir -p "$d"; mk_typed_spec "$d" spike "Questions & Timebox"; mk_clean_plan "$d"; mk_clean_tasks "$d"
assert_exit_zero "AC10 spike spec passes" "$d"
d="$TMPROOT/ac10-noac"; mkdir -p "$d"
printf '# Spec\n\n**Type**: chore\n\n## Goal\ng\n\n## Checklist\n\n- [x] bump dep\n' > "$d/spec.md"
assert_exit_nonzero "AC10 chore spec without AC id" "$d"
assert_report_contains "AC10 names AC id" "$d" "MISSING required section: acceptance scenario id (AC#)"
d="$TMPROOT/ac10-choreplan"; mkdir -p "$d"
printf '# Spec\n\n**Type**: chore\n\n## Goal\ng\n\n## Checklist\n\n- [x] AC1 bump\n' > "$d/spec.md"
printf '# Plan\n\n**Type**: chore\n\n## Summary\nno diagram needed\n' > "$d/plan.md"
assert_exit_zero "AC10 chore plan exempt from mermaid" "$d"
assert_report_contains "AC10 chore plan exempt note" "$d" "mermaid not required (type=chore)"

# AC11 — run.md (XS micro-lane single artifact): a dir with only run.md passes
# when it carries the contract core; missing verify fails; AC prose is allowed
# in run.md (spec-surrogate exemption from the locality check).
d="$TMPROOT/ac11-clean"; mkdir -p "$d"
printf '# Run\n\n**Type**: chore\n\n## Goal\ng\n\n## Acceptance\n- [x] **AC1** — **Given** a, **When** b, **Then** c.\n\n## Tasks\n- [x] T001 [AC1] do — verify: ok\n' > "$d/run.md"
assert_exit_zero "AC11 clean run.md-only dir" "$d"
d="$TMPROOT/ac11-noverify"; mkdir -p "$d"
printf '# Run\n\n**Type**: chore\n\n## Goal\ng\n\n## Acceptance\n- [x] AC1 ok\n\n## Tasks\n- [x] T001 [AC1] do\n' > "$d/run.md"
assert_exit_nonzero "AC11 run.md missing verify" "$d"
assert_report_contains "AC11 names missing verify" "$d" "MISSING required section: runnable verify section"

# AC12 — the brownfield contract, gated on `state.json > field`. `## Guardrails`
# (tasks.md) and `## Current state` (plan.md) are the *lock* and *understand*
# halves of brownfield's understand → lock → change discipline, mandatory in
# prose since forever and checked nowhere: all three golden brownfield fixtures
# shipped without Guardrails, which is what an exemplar teaches. Greenfield has
# nothing to guard, so the checks must stay silent there — an over-eager version
# would fail every greenfield run and get switched off.
mk_state() { printf '{"id":"%s","type":"%s","size":"S","field":"%s"}' "$2" "$3" "$4" > "$1/state.json"; }
TASKS_BODY='# Tasks\n\n## Phase 1\n\n- [x] T001 [AC1] do the thing — verify: the suite is green\n'
PLAN_BODY='# Plan\n\n**Type**: feat\n\n## Summary\ns\n\n```mermaid\nflowchart LR\n  A --> B\n```\n'

d="$TMPROOT/ac12-bf-no-guard"; mkdir -p "$d"; mk_state "$d" 0012-feat-x feat brownfield
printf "$TASKS_BODY" > "$d/tasks.md"
assert_exit_nonzero "AC12 brownfield tasks.md without Guardrails" "$d"
assert_report_contains "AC12 names the missing Guardrails" "$d" "MISSING required section: ## Guardrails"

d="$TMPROOT/ac12-bf-empty-guard"; mkdir -p "$d"; mk_state "$d" 0012-feat-x feat brownfield
printf "# Tasks\n\n## Guardrails\n\n- keep it working\n\n- [x] T001 [AC1] do — verify: green\n" > "$d/tasks.md"
assert_exit_nonzero "AC12 Guardrails header with no cited invariant" "$d"
assert_report_contains "AC12 names the uncited Guardrails" "$d" "cites no backticked"

d="$TMPROOT/ac12-bf-ok"; mkdir -p "$d"; mk_state "$d" 0012-feat-x feat brownfield
printf "# Tasks\n\n## Guardrails\n\n- \`\`\`app/svc.rb#total\`\`\` — returns cents; callers depend on it\n\n- [x] T001 [AC1] do — verify: green\n" > "$d/tasks.md"
assert_exit_zero "AC12 brownfield Guardrails citing a path#anchor" "$d"

d="$TMPROOT/ac12-gf"; mkdir -p "$d"; mk_state "$d" 0012-feat-x feat greenfield
printf "$TASKS_BODY" > "$d/tasks.md"
assert_exit_zero "AC12 greenfield needs no Guardrails" "$d"

# No state.json => no field => skipped, never a false failure (the linter runs on
# hand-made dirs and on legacy runs predating the `field` axis).
d="$TMPROOT/ac12-nostate"; mkdir -p "$d"
printf "$TASKS_BODY" > "$d/tasks.md"
assert_exit_zero "AC12 no state.json skips the brownfield checks" "$d"

d="$TMPROOT/ac12-bf-plan"; mkdir -p "$d"; mk_state "$d" 0012-feat-x feat brownfield
printf "$PLAN_BODY" > "$d/plan.md"
assert_exit_nonzero "AC12 brownfield plan.md without Current state" "$d"
assert_report_contains "AC12 names the missing Current state" "$d" "## Current state (brownfield understand step)"

d="$TMPROOT/ac12-bf-plan-ok"; mkdir -p "$d"; mk_state "$d" 0012-feat-x feat brownfield
printf "$PLAN_BODY\n## Current state\n\n- Entry — \`app/svc.rb#total\`\n" > "$d/plan.md"
assert_exit_zero "AC12 brownfield plan.md with Current state" "$d"

# A spike explores rather than changes — `lead.md` step 2 exempts it, so must the
# linter, or the 06-spike scenario fixture fails for conforming to the playbook.
d="$TMPROOT/ac12-spike"; mkdir -p "$d"; mk_state "$d" 0012-spike-x spike brownfield
printf '# Plan\n\n**Type**: spike\n\n## Summary\ns\n\n```mermaid\nflowchart LR\n  A --> B\n```\n' > "$d/plan.md"
assert_exit_zero "AC12 spike plan exempt from Current state" "$d"

echo
total_pass=$(( $(echo "AC6 AC6 AC6 AC6 AC1 AC1 AC1 AC2 AC2 AC2 AC2 AC2 AC3 AC3 AC3 AC3 AC4 AC4 AC4 AC4 AC4 AC4 AC5 AC5 AC5 AC5 AC7 AC7 AC7 AC7 AC7 AC8 AC8 AC8 AC8 AC8 AC10 AC10 AC10 AC10 AC10 AC10 AC10 AC10 AC10 AC11 AC11 AC11 AC12 AC12 AC12 AC12 AC12 AC12 AC12 AC12 AC12 AC12" | wc -w) ))
# AC9 runs only when jq is present (see the skip above).
command -v jq >/dev/null 2>&1 && total_pass=$((total_pass + 4))
if [ "$failures" -eq 0 ]; then
  echo "artifact-lint tests: ALL PASS ($total_pass/$total_pass assertions)"
  exit 0
else
  echo "artifact-lint tests: $failures assertion(s) FAILED" >&2
  exit 1
fi
