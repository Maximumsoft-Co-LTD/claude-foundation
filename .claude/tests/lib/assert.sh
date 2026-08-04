#!/usr/bin/env sh
# assert.sh — shared assertion helpers for the workflow test harness.
#
# Source this AFTER `set -eu`. It maintains two counters ($asserts, $failures)
# and prints PASS/FAIL lines in the same style as the hook / artifact-lint
# suites (a hard dependency-free, framework-free convention). End a suite with
# `finish "<suite-name>"` to print the summary and exit 0 (all pass) / 1 (any
# fail). Every field the harness compares is space-free, so callers can parse
# the data tables with the default IFS — no tab/delimiter fragility.

asserts=0
failures=0

pass() { asserts=$((asserts + 1)); echo "PASS: $1"; }
fail() { asserts=$((asserts + 1)); failures=$((failures + 1)); echo "FAIL: $1" >&2; }

# assert_file_exists <label> <path>
assert_file_exists() {
  if [ -f "$2" ]; then pass "$1"; else fail "$1 — expected file present: $2"; fi
}

# assert_file_absent <label> <path>
assert_file_absent() {
  if [ ! -e "$2" ]; then pass "$1"; else fail "$1 — expected file ABSENT: $2"; fi
}

# assert_eq <label> <expected> <actual>
assert_eq() {
  if [ "$2" = "$3" ]; then pass "$1 (= $2)"; else fail "$1 — expected '$2', got '$3'"; fi
}

# assert_in <label> <value> <space-separated-allowed-set>
assert_in() {
  for _v in $3; do
    if [ "$_v" = "$2" ]; then pass "$1 (= $2)"; return 0; fi
  done
  fail "$1 — '$2' not in {$3}"
}

# assert_file_contains <label> <path> <fixed-substring>
assert_file_contains() {
  if grep -qF -- "$3" "$2" 2>/dev/null; then pass "$1"; else fail "$1 — '$3' not in $(basename "$2")"; fi
}

# assert_file_not_contains <label> <path> <fixed-substring>
assert_file_not_contains() {
  if grep -qF -- "$3" "$2" 2>/dev/null; then
    fail "$1 — unexpected '$3' in $(basename "$2")"
  else
    pass "$1"
  fi
}

# assert_contains <label> <haystack-string> <fixed-substring>
assert_contains() {
  if printf '%s' "$2" | grep -qF -- "$3"; then pass "$1"; else fail "$1 — '$3' not found in output"; fi
}

# assert_not_contains <label> <haystack-string> <fixed-substring>
assert_not_contains() {
  if printf '%s' "$2" | grep -qF -- "$3"; then
    fail "$1 — unexpected '$3' in output"
  else
    pass "$1"
  fi
}

# assert_cmd_zero <label> <cmd> [args...] — run cmd quietly, expect exit 0.
assert_cmd_zero() {
  _label="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$_label"; else fail "$_label — command failed: $*"; fi
}

# json_get <file> <top-level-key> — prints the scalar value ("" if absent).
# Prefers jq; falls back to a grep/sed scan good enough for the controlled
# state.json fixtures (space-free scalar values).
json_get() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$2" '.[$k] // empty' "$1" 2>/dev/null || true
  else
    grep -m1 "\"$2\"[[:space:]]*:" "$1" 2>/dev/null \
      | sed -e 's/.*:[[:space:]]*//' -e 's/^"//' -e 's/",\{0,1\}[[:space:]]*$//' -e 's/,[[:space:]]*$//' || true
  fi
}

# finish <suite-name>
finish() {
  echo
  if [ "$failures" -eq 0 ]; then
    echo "$1: ALL PASS ($asserts/$asserts assertions)"
    exit 0
  else
    echo "$1: $failures/$asserts assertion(s) FAILED" >&2
    exit 1
  fi
}
