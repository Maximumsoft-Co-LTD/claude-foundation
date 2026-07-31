#!/usr/bin/env sh
# run-scenario-tests.sh — scenario-conformance suite for /dev runs.
#
# For each scenario (a committed golden .workflow/<id>/ fixture) it asserts the
# run is internally consistent AND conforms to the type-aware phase matrix:
#   1. artifact-lint.sh exits 0 on the run dir (the artifacts are valid exemplars)
#   2. state.json's type/size/field match the scenario's declared axes, and the
#      run-id slug's <type> matches state.json's type
#   3. every artifact the scenario REQUIRES is present
#   4. every artifact the matrix marks `skip` for this type is ABSENT
#      (test-plan.md / tests.md / security.md — the machine-checkable skips)
#   5. field invariants: greenfield => size in {XS,S} and no context.md
#
# The matrix lives in ../phase-matrix.tsv (kept in sync with WORKFLOW.md by
# run-doc-consistency.sh). Flip a skip->yes there and the matching fixture
# starts failing until its artifact set is updated — the matrix is executable.
#
# Invocation: sh run-scenario-tests.sh   (from any cwd). Needs no network, no
# Claude session, no jq (jq is used opportunistically for state.json reads).

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"            # .../tests/scenarios -> repo root
LINTER="$ROOT/.claude/hooks/artifact-lint.sh"
MATRIX="$HERE/../phase-matrix.tsv"
SCEN="$HERE/scenarios.tsv"

. "$HERE/../lib/assert.sh"

for f in "$LINTER" "$MATRIX" "$SCEN"; do
  [ -f "$f" ] || { echo "FAIL: missing harness file $f" >&2; exit 1; }
done

# matrix_cell <phase> <type> — the cell for one phase row / type column.
matrix_cell() {
  awk -v p="$1" -v t="$2" '
    /^#/ || NF==0 { next }
    !seen { for (i = 1; i <= NF; i++) col[$i] = i; seen = 1; next }
    $1 == p { print $(col[t]); exit }
  ' "$MATRIX"
}

echo "Running scenario-conformance suite..."
echo

while read -r dir type size field require; do
  case "$dir" in ''|'#'*) continue ;; esac
  base="$HERE/fixtures/$dir"

  if [ ! -d "$base/.workflow" ]; then
    fail "$dir — no .workflow/ under fixture"
    continue
  fi
  rundir="$(find "$base/.workflow" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n1)"
  if [ -z "$rundir" ] || [ ! -d "$rundir" ]; then
    fail "$dir — no run directory under .workflow/"
    continue
  fi
  runid="$(basename "$rundir")"

  # 1. artifacts are valid exemplars.
  assert_cmd_zero "$dir: artifact-lint passes" sh "$LINTER" "$rundir"

  # 2. axes match state.json + the run-id slug.
  state="$rundir/state.json"
  if [ -f "$state" ]; then
    assert_eq "$dir: state.type"  "$type"  "$(json_get "$state" type)"
    assert_eq "$dir: state.size"  "$size"  "$(json_get "$state" size)"
    assert_eq "$dir: state.field" "$field" "$(json_get "$state" field)"
    assert_eq "$dir: run-id slug <type>" "$type" "$(echo "$runid" | cut -d- -f2)"
  else
    fail "$dir — state.json missing at $state"
  fi
  assert_in "$dir: size domain"  "$size"  "XS S M L"
  assert_in "$dir: field domain" "$field" "greenfield brownfield"

  # 3. required artifacts present.
  for art in $(echo "$require" | tr ',' ' '); do
    assert_file_exists "$dir: has $art" "$rundir/$art"
  done

  # 4. matrix-skip => artifact absent (the executable-matrix check).
  for pair in "test-plan test-plan.md" "test tests.md" "security security.md"; do
    ph="${pair%% *}"; art="${pair##* }"
    cell="$(matrix_cell "$ph" "$type")"
    if [ "$cell" = "skip" ]; then
      assert_file_absent "$dir: $art absent (matrix: $ph=skip for $type)" "$rundir/$art"
    fi
  done

  # 5. field invariants.
  if [ "$field" = "greenfield" ]; then
    assert_in "$dir: greenfield size cap" "$size" "XS S"
    assert_file_absent "$dir: greenfield has no context.md" "$rundir/context.md"
  fi
done < "$SCEN"

finish "scenario tests"
