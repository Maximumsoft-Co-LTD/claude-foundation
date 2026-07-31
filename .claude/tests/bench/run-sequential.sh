#!/usr/bin/env sh
# run-sequential.sh — two changes, ONE repo, in order. Measures whether a run
# gets cheaper because an earlier run already mapped the code.
#
# Every other runner here starts each repeat from a pristine sandbox, which makes
# them structurally blind to the largest cost in the profile: **boot is 44% of an
# XS run's wall clock and Design another 39%**, and most of that is re-deriving
# what a previous run on the same code already established. A fresh sandbox per
# repeat guarantees that saving can never appear. So this runner does what a real
# repo does — a second ask lands on the same working tree, with the first run's
# `.workflow/` still there.
#
#   sh run-sequential.sh --task 14-accumulate --out results/seq.jsonl [--keep]
#
# Reads `workflow.txt` then `workflow2.txt` from the task dir and emits one row
# per step with `seq: 1|2`. The number that matters is run 2's cost against run
# 1's: with no accumulation they are the same, and any mechanism that carries
# knowledge forward should show up as run 2 being cheaper. No judge — this
# measures cost/wall only, and grading a follow-on change against the first
# change's acceptance file would be meaningless.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
TASK=""; OUT=""; KEEP=0; MODEL="${BENCH_MODEL:-sonnet}"; TIMEOUT_S="${BENCH_TIMEOUT:-1800}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift ;;
    --out)  OUT="$2";  shift ;;
    --keep) KEEP=1 ;;
    *) echo "run-sequential: unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$TASK" ] && [ -n "$OUT" ] || { echo "usage: run-sequential.sh --task <name> --out <file> [--keep]" >&2; exit 2; }

TDIR="$HERE/tasks/$TASK"
[ -f "$TDIR/workflow.txt" ] && [ -f "$TDIR/workflow2.txt" ] || {
  echo "run-sequential: $TASK needs both workflow.txt and workflow2.txt" >&2; exit 2; }

SANDROOT="$(mktemp -d)"
cleanup() { [ "$KEEP" = 1 ] || rm -rf "$SANDROOT"; }
trap 'cleanup' EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

sb="$SANDROOT/$TASK"
mkdir -p "$sb/.workflow"
cp -R "$ROOT/.claude" "$sb/.claude"
rm -rf "$sb/.claude/tests"          # never ship the bench's answer keys into a graded sandbox
[ -f "$ROOT/WORKFLOW.md" ] && cp "$ROOT/WORKFLOW.md" "$sb/"
[ -f "$ROOT/CLAUDE.md" ]   && cp "$ROOT/CLAUDE.md"   "$sb/"
cp -R "$ROOT/.workflow/_templates" "$sb/.workflow/_templates"
printf '# Index\n\n| ID | Type | Title | Status | Created | Updated |\n|----|------|-------|--------|---------|---------|\n' > "$sb/.workflow/INDEX.md"
[ -d "$TDIR/seed" ] && cp -R "$TDIR/seed/." "$sb/"
( cd "$sb" && git init -q && git add -A && git -c user.email=b@b -c user.name=bench commit -qm seed ) >/dev/null 2>&1 || true

mkdir -p "$(dirname "$OUT")"; : > "$OUT"
echo "sandbox: $sb"

step() { # $1 = seq number, $2 = prompt file
  envf="$SANDROOT/step$1.envelope.json"
  echo ">> run $1/2 — $(basename "$2")"
  t0="$(date +%s)"
  ( cd "$sb" && claude -p "$(cat "$2")" --output-format json --dangerously-skip-permissions --model "$MODEL" ) \
    > "$envf" 2>/dev/null || true
  wall=$(( $(date +%s) - t0 ))
  robj="$(jq -c 'if type=="array" then ((map(select(.type=="result")) | last) // .[-1] // {}) else . end' "$envf" 2>/dev/null || echo '{}')"
  cost="$(printf '%s' "$robj" | jq -r '.total_cost_usd // "null"')"
  turns="$(printf '%s' "$robj" | jq -r '.num_turns // "null"')"
  # A run that never stamps done_at produced artifacts but did not finish — the
  # same silent half-run the main runner flags, and it must not be averaged in.
  done_at="$(jq -r '.done_at // ""' "$sb"/.workflow/*/state.json 2>/dev/null | grep -v '^$' | tail -1)"
  ok=true; [ -n "$done_at" ] || ok=false
  printf '{"task":"%s","seq":%s,"ok":%s,"cost_usd":%s,"turns":%s,"wall_s":%s}\n' \
    "$TASK" "$1" "$ok" "$cost" "$turns" "$wall" >> "$OUT"
  echo "   cost=\$$cost wall=${wall}s turns=$turns ok=$ok"
}

step 1 "$TDIR/workflow.txt"
step 2 "$TDIR/workflow2.txt"

echo
jq -s '{run1: .[0], run2: .[1],
        delta_pct: (if (.[0].cost_usd and .[1].cost_usd and .[0].cost_usd > 0)
                    then (((.[1].cost_usd - .[0].cost_usd) / .[0].cost_usd) * 1000 | round / 10)
                    else null end)}' "$OUT"
[ "$KEEP" = 1 ] && echo "kept: $sb"
exit 0
