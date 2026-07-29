#!/usr/bin/env sh
# smoke.sh — the fast loop. ~3 minutes, ~$2, run it after every change.
#
# The full workflow arm needs n=6-8 to resolve anything (this suite's cost sd is
# ~25% of its mean), so every verdict costs 8+ minutes and ~$20. That is far too
# slow to iterate on, and iterating slowly is how a session ends up adopting four
# "wins" that were all inside the noise.
#
# So: TWO TIERS. This is tier 1 — a directional go/no-go you can afford to run
# constantly. It uses the **design arm** (`/dev --yes --plan-only`, Phase 1 only)
# graded by `grade-design.sh`, which is DETERMINISTIC — no model, no tokens, no
# variance — so **n=2 is enough to trust it**, where the outcome judge needs six.
# It also reports the tool-call count, which tracks cost far more tightly than
# any single cost sample does.
#
#   sh smoke.sh                      # default task, 2 runs
#   sh smoke.sh --task 11-recent-window --repeats 2
#   sh smoke.sh --turns              # + one instrumented run for the call inventory
#
# WHAT IT CANNOT TELL YOU (do not skip this): the design arm stops at the gate, so
# it sees nothing about Implement, Test, Review or the delivered code. A change to
# those phases scores identically here whether it helps or harms. And a perfect
# design grade means "the artifact set hangs together", never "this is a good
# design" — only the outcome judge on real code sees whether the spec caught what
# the user never said. **Iterate here; decide with `run-parallel.sh --arm workflow`
# at n>=6 and `compare.sh --gain`, which will refuse a sub-MDE delta.**
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TASK="11-recent-window"; REPEATS=2; TURNS=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift ;;
    --repeats) REPEATS="$2"; shift ;;
    --turns) TURNS=1 ;;
    *) echo "smoke: unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done

stamp="$(date +%H%M%S)"
out="$HERE/results/smoke-$stamp.jsonl"
echo "smoke: design arm × $REPEATS on $TASK  (deterministic grade — no judge tokens)"
sh "$HERE/run-parallel.sh" --arm design --tasks "$TASK" --repeats "$REPEATS" --out "$out" >/dev/null 2>&1 || true

if [ -s "$out" ]; then
  jq -s -r '
    map(select(.ok)) as $ok
    | if ($ok | length) == 0 then "  ✗ no usable run — check \(env.OUTF)"
      else
        ($ok | map(.judge_score) | add / length) as $g
        | ($ok | map(.cost_usd) | add / length) as $c
        | ($ok | map(.wall_s) | add / length) as $w
        | ($ok | map(.turns) | add / length) as $t
        | "  design grade : \($g)/10   \(if $g == 10 then "PASS — artifact set complete + self-consistent" else "FAIL — see grade-design.sh checks" end)",
          "  cost         : $\(($c*100|round)/100) avg",
          "  wall         : \(($w|round))s avg",
          "  turns        : \(($t|round)) avg",
          "  n            : \($ok|length) (deterministic grade — n=2 is enough HERE, not for cost)"
      end' "$out"
else
  echo "  ✗ smoke produced no rows"
fi

if [ "$TURNS" = 1 ]; then
  echo
  echo "smoke: tool-call inventory (1 instrumented run)"
  sh "$HERE/profile-turns.sh" --task "$TASK" 2>/dev/null | sed -n '/round-trips/,/^$/p' | sed 's/^/  /'
fi

echo
echo "  ↑ directional only. Before adopting anything:"
echo "     sh run-parallel.sh --arm workflow --tasks $TASK --repeats 6 --out results/x.jsonl"
echo "     sh compare.sh --gain <baseline> results/x.jsonl     # refuses a sub-MDE delta"
echo "     sh compare.sh --mde results/x.jsonl 20              # how many repeats a 20% effect needs"
