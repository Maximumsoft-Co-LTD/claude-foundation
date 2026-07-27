#!/usr/bin/env sh
# judge.sh — LLM-as-judge quality grade for one /dev run directory.
#
# Reads the run's spec/plan/tasks/test-plan, hands them to Claude with rubric.md,
# and expects a strict-JSON score back. Structural validity is artifact-lint's
# job; this scores the part a linter can't — AC quality, plan↔spec fit, task
# executability, type discipline, simplicity.
#
# Usage:  sh judge.sh <path-to-run-dir> [--model <id>]
# Exit:   0 = verdict pass (score >= 7, no zero dimension)
#         1 = verdict fail
#         2 = could not judge (no `claude` CLI, no artifacts, or unparseable reply)
#
# Requires the `claude` CLI and jq. Costs tokens — invoked only by run-e2e.sh in
# live mode, never by the deterministic suites.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
RUBRIC="$HERE/rubric.md"
MODEL="sonnet"

dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    *) dir="$1"; shift ;;
  esac
done

[ -n "$dir" ] && [ -d "$dir" ] || { echo "judge: not a run dir: ${dir:-<none>}" >&2; exit 2; }
command -v claude >/dev/null 2>&1 || { echo "judge: SKIP — no claude CLI" >&2; exit 2; }
command -v jq >/dev/null 2>&1     || { echo "judge: SKIP — no jq" >&2; exit 2; }

# Gather the artifacts that exist.
bundle=""
found=0
for a in spec.md plan.md tasks.md test-plan.md run.md; do
  f="$dir/$a"
  [ -f "$f" ] || continue
  found=$((found + 1))
  bundle="$bundle

===== $a =====
$(cat "$f")"
done
[ "$found" -gt 0 ] || { echo "judge: no artifacts in $dir" >&2; exit 2; }

prompt="$(cat "$RUBRIC")

Grade the following /dev run artifacts. Reply with ONLY the JSON object.
$bundle"

# `claude -p` prints the model's text reply on stdout; ask for bare JSON and
# extract the first {...} object defensively.
reply="$(printf '%s' "$prompt" | claude -p --model "$MODEL" 2>/dev/null || true)"
json="$(printf '%s' "$reply" | tr -d '\r' | sed -n 's/.*\({.*}\).*/\1/p' | head -n1)"
[ -z "$json" ] && json="$(printf '%s' "$reply" | grep -o '{.*}' | head -n1 || true)"

if [ -z "$json" ] || ! printf '%s' "$json" | jq -e . >/dev/null 2>&1; then
  echo "judge: SKIP — unparseable reply for $(basename "$dir"): ${reply:-<empty>}" >&2
  exit 2
fi

score="$(printf '%s' "$json" | jq -r '.score // 0')"
verdict="$(printf '%s' "$json" | jq -r '.verdict // "fail"')"
notes="$(printf '%s' "$json" | jq -r '.notes // ""')"
echo "judge: $(basename "$dir") — score=$score verdict=$verdict :: $notes"

[ "$verdict" = "pass" ] && exit 0 || exit 1
