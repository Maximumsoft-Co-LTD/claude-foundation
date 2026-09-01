#!/usr/bin/env sh
# grade-design.sh — the design arm's quality signal. DETERMINISTIC: no model, no
# tokens, no variance. Reads a finished `.workflow/<id>/` and asks whether the
# pipeline produced a design set that is *complete and self-consistent*:
#
#   1. artifact-lint.sh exits 0 on the run dir (required sections present, no
#      placeholders, no scaffold leftovers, and — for brownfield — the Guardrails
#      and Current-state contract).
#   2. every acceptance id in the spec has at least one `[AC<n>]`-tagged task.
#   3. (feat/fix/refactor) every acceptance id has a Coverage-plan row.
#
# WHAT IT CANNOT TELL YOU: whether the spec captured the requirements the user
# never stated. That gap is the whole point of the benchmark's headroom rule, and
# only the outcome judge on delivered code can see it. So a 10 here means "the
# design set hangs together", NOT "this is a good design". Use the design arm to
# iterate on STRUCTURAL changes (who writes what, how many spawns, which phase
# runs where) and confirm with a full `workflow` arm before believing a verdict.
#
# Score: 10 when all three hold; −3 per failing check, floored at 0. Verdict is
# `pass` at 10 and `fail` otherwise — the checks are binary and cheap, so there is
# no reason for a design set to ship failing one.
#
# Usage: sh grade-design.sh <sandbox-dir>
# Out:   {"score":N,"verdict":"pass|fail","lint":bool,"ac_total":N,"ac_tasked":N,"ac_covered":N}
# Exit:  0 always when it could grade; 2 when no run dir exists (unjudgeable).

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
LINTER="$ROOT/.claude/hooks/artifact-lint.sh"
sb="${1:?usage: grade-design.sh <sandbox-dir>}"

rd="$(find "$sb/.workflow" -mindepth 1 -maxdepth 1 -type d ! -name _templates 2>/dev/null | head -n1 || true)"
[ -n "$rd" ] && [ -d "$rd" ] || { echo "grade-design: no run dir under $sb/.workflow" >&2; exit 2; }

# The XS micro-lane folds all four artifacts into run.md; S and up keep them split.
if [ -f "$rd/run.md" ]; then
  spec="$rd/run.md"; tasks="$rd/run.md"; cover="$rd/run.md"
else
  spec="$rd/spec.md"; tasks="$rd/tasks.md"; cover="$rd/test-plan.md"
fi

lint=false
if [ -f "$LINTER" ]; then
  sh "$LINTER" "$rd" >/dev/null 2>&1 && lint=true
elif [ -f "$rd/run.md" ]; then
  # The retired .workflow hook is not installed by the OpenSpec-native runtime.
  # Keep legacy design scoring strict with a local structural fallback.
  if [ -s "$rd/run.md" ] &&
     grep -q '^## Acceptance' "$rd/run.md" &&
     grep -q '^## Tasks' "$rd/run.md" &&
     grep -q '^## Coverage plan' "$rd/run.md" &&
     ! grep -qE 'TODO|TBD|<[^>]+>' "$rd/run.md"; then lint=true; fi
else
  if [ -s "$rd/spec.md" ] && [ -s "$rd/plan.md" ] &&
     [ -s "$rd/tasks.md" ] && [ -s "$rd/test-plan.md" ] &&
     grep -q '^## Goal' "$rd/spec.md" &&
     grep -q '^## User Stories' "$rd/spec.md" &&
     grep -q '^## Acceptance' "$rd/spec.md" &&
     grep -q '^## Functional Requirements' "$rd/spec.md" &&
     grep -q '^## Success Criteria' "$rd/spec.md" &&
     grep -q '^## Summary' "$rd/plan.md" &&
     grep -q '^```mermaid' "$rd/plan.md" &&
     grep -qE '^-[[:space:]]+\[[ x]\][[:space:]]+T[0-9]+' "$rd/tasks.md" &&
     grep -q '^## Coverage plan' "$rd/test-plan.md" &&
     ! grep -qE 'TODO|TBD|<[^>]+>' "$rd/spec.md" "$rd/plan.md" \
       "$rd/tasks.md" "$rd/test-plan.md"; then lint=true; fi
fi

# Acceptance ids as declared by the spec surface. Dedup + sort so a repeated
# mention is not double-counted.
acs="$(grep -oE '\bAC[0-9]+\b' "$spec" 2>/dev/null | sort -u || true)"
ac_total=0; ac_tasked=0; ac_covered=0
type_line="$(grep -m1 -F '**Type**:' "$spec" 2>/dev/null | sed -e 's/.*\*\*Type\*\*:[[:space:]]*//' -e 's/[[:space:]|].*//' || true)"
case "${type_line:-feat}" in chore|docs|spike) want_cover=0 ;; *) want_cover=1 ;; esac

for ac in $acs; do
  ac_total=$((ac_total + 1))
  # A delivering task tags the id in brackets — the plan-writing task format.
  grep -qE "\[$ac\]" "$tasks" 2>/dev/null && ac_tasked=$((ac_tasked + 1)) || true
  if [ "$want_cover" = "1" ]; then
    grep -qE "\b$ac\b" "$cover" 2>/dev/null && ac_covered=$((ac_covered + 1)) || true
  fi
done
[ "$want_cover" = "1" ] || ac_covered="$ac_total"   # not applicable => not a deduction

score=10
[ "$lint" = "true" ]                  || score=$((score - 3))
[ "$ac_total" -gt 0 ] && [ "$ac_tasked"  -eq "$ac_total" ] || score=$((score - 3))
[ "$ac_total" -gt 0 ] && [ "$ac_covered" -eq "$ac_total" ] || score=$((score - 3))
[ "$score" -lt 0 ] && score=0
[ "$score" -eq 10 ] && verdict=pass || verdict=fail

printf '{"score":%s,"verdict":"%s","lint":%s,"ac_total":%s,"ac_tasked":%s,"ac_covered":%s}\n' \
  "$score" "$verdict" "$lint" "$ac_total" "$ac_tasked" "$ac_covered"
