#!/usr/bin/env sh
# run-artifact-lint-tests.sh — fixtures-based test suite for artifact-lint.sh.
#
# The two load-bearing assertions (the spec's AC6) drive off the COMMITTED
# fixtures:
#   - exits 0     on the clean  pass/ fixture
#   - exits non-0 on the broken fail/ fixture (missing section + placeholder)
#
# The remaining assertions map each acceptance criterion (AC1–AC5) to a focused
# behaviour check, built from throwaway temp fixtures so the committed fixtures
# stay minimal. Every assertion is one suite run; the suite runs in this single
# process. Paths are resolved relative to THIS script's location, so the runner
# is invariant to the caller's working directory. Exit 0 iff every assertion holds.

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
mk_clean_spec() { printf '# Spec\n\n**Type**: feat\n\n## Acceptance criteria\n- [x] AC1: ok\n' > "$1/spec.md"; }
mk_clean_plan() { printf '# Plan\n\n## Architecture diagram\n```mermaid\nflowchart LR\nA-->B\n```\n\n## Steps\n1. do — verify: x [AC1]\n' > "$1/plan.md"; }

echo "Running artifact-lint test suite..."
echo

# AC6 — the brief's required committed-fixture assertions.
assert_exit_zero    "AC6 pass-fixture"  "$PASS_DIR"
assert_exit_nonzero "AC6 fail-fixture"  "$FAIL_DIR"
assert_report_contains "AC6 fail-fixture report" "$FAIL_DIR" "MISSING required section: Acceptance criteria"
assert_report_contains "AC6 fail-fixture report" "$FAIL_DIR" "placeholder marker"

# AC1 — a fully clean run dir exits 0; a dir with no recognised artifact fails.
d="$TMPROOT/ac1-clean"; mkdir -p "$d"; mk_clean_spec "$d"; mk_clean_plan "$d"
assert_exit_zero "AC1 clean dir" "$d"
d="$TMPROOT/ac1-noart"; mkdir -p "$d"; echo '{}' > "$d/state.json"
assert_exit_nonzero "AC1 no recognised artifact" "$d"
assert_report_contains "AC1 no-artifact message" "$d" "no lintable artifacts found"

# AC2 — spec missing the acceptance section is named + fails.
d="$TMPROOT/ac2"; mkdir -p "$d"; printf '# Spec\n\n**Type**: feat\n\n## Outcome\nx\n' > "$d/spec.md"
assert_exit_nonzero "AC2 spec missing acceptance" "$d"
assert_report_contains "AC2 names missing section" "$d" "MISSING required section: Acceptance criteria"
# spec missing Type is named too.
d="$TMPROOT/ac2b"; mkdir -p "$d"; printf '# Spec\n\n## Acceptance criteria\n- [x] AC1\n' > "$d/spec.md"
assert_report_contains "AC2 names missing Type" "$d" "MISSING required section: Type declaration"

# AC3 — plan missing each required element is named + fails.
d="$TMPROOT/ac3"; mkdir -p "$d"; mk_clean_spec "$d"
printf '# Plan\n\n## Approach\nno diagram, no tag, no verify\n' > "$d/plan.md"
assert_exit_nonzero "AC3 plan missing elements" "$d"
assert_report_contains "AC3 names missing mermaid" "$d" "MISSING required section: mermaid diagram"
assert_report_contains "AC3 names missing AC tag" "$d" "MISSING required section: inline AC tag"
assert_report_contains "AC3 names missing verify" "$d" "MISSING required section: runnable verify section"

# AC4 — placeholder markers (word + angle) reported with line numbers; fenced/backticked ignored.
d="$TMPROOT/ac4"; mkdir -p "$d"; mk_clean_plan "$d"
printf '# Spec\n\n**Type**: feat\n\n## Acceptance criteria\n- [x] AC1\n- TODO finish\n- handle <id>\n- lorem ipsum\n- FIXME this\n' > "$d/spec.md"
assert_exit_nonzero "AC4 placeholders present" "$d"
assert_report_contains "AC4 reports TODO" "$d" "placeholder marker: TODO"
assert_report_contains "AC4 reports angle"  "$d" "placeholder marker: <...>"
assert_report_contains "AC4 reports lorem"  "$d" "placeholder marker: lorem"
assert_report_contains "AC4 reports FIXME"  "$d" "placeholder marker: FIXME"
# code-span + fence exclusion: documented markers do NOT fail.
d="$TMPROOT/ac4-doc"; mkdir -p "$d"; mk_clean_plan "$d"
printf '# Spec\n\n**Type**: feat\n\n## Acceptance criteria\n- [x] AC1: we document `TODO` and `<id>` here\n```\nTODO inside a fence is ignored\n```\n' > "$d/spec.md"
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

echo
total_pass=$(( $(echo "AC6 AC6 AC6 AC6 AC1 AC1 AC1 AC2 AC2 AC2 AC3 AC3 AC3 AC3 AC4 AC4 AC4 AC4 AC4 AC4 AC5 AC5 AC5 AC5" | wc -w) ))
if [ "$failures" -eq 0 ]; then
  echo "artifact-lint tests: ALL PASS ($total_pass/$total_pass assertions)"
  exit 0
else
  echo "artifact-lint tests: $failures assertion(s) FAILED" >&2
  exit 1
fi
