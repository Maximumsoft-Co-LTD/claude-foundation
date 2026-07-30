#!/usr/bin/env sh
# Deterministic AC oracle for 11-recent-window — the whole task, one JSON row.
#
#   sh run.sh <sandbox-dir>
#
# AC1 is the SWE-bench FAIL_TO_PASS contract and cannot be checked by reading the
# delivered code: the shipped test must pass against the delivered window.js AND
# fail against the pristine one. A suite that stays green when the bug is put back
# does not pin the bug, however thorough it looks. So we run it twice, in a COPY —
# the graded sandbox is never mutated.
#
# AC2..AC5 are direct behavioural assertions (check.cjs).
#
# Output: {"results":{...},"score":n,"max":5,"verdict":"pass|fail","note":[...]}
# verdict=pass iff every AC passes — an AC oracle has no partial credit to give.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
SEED="$HERE/../seed"
SB="${1:-}"
[ -n "$SB" ] && [ -d "$SB" ] || { echo '{"error":"usage: run.sh <sandbox-dir>"}'; exit 2; }
command -v node >/dev/null 2>&1 || { echo '{"error":"node not found"}'; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

cp -R "$SB/." "$WORK/" 2>/dev/null || true
rm -rf "$WORK/.git" "$WORK/.workflow" "$WORK/.claude" 2>/dev/null || true

# Collect the shipped test files as PATHS RELATIVE TO $WORK. Two traps here, both
# hit for real while building this: `node --test <dir>` prints "Could not find"
# and still exits 0 on Node 26 — which would score a sandbox with zero tests as a
# green suite — and the tests `require("./window")`, so they only resolve with cwd
# inside the tree. So: explicit file list, run from inside $WORK.
tests=""
for p in "$WORK"/*.test.js "$WORK"/*.test.cjs "$WORK"/*.test.mjs "$WORK"/*.spec.js \
         "$WORK"/test/*.js "$WORK"/tests/*.js "$WORK"/__tests__/*.js; do
  [ -f "$p" ] || continue
  tests="$tests ${p#"$WORK"/}"
done

run_suite() { ( cd "$WORK" && eval "node --test $tests" >/dev/null 2>&1 ); }

ac1="fail"; ac1_why="no test file shipped"
if [ -n "$tests" ]; then
  if run_suite; then
    # Green on the delivered tree. Now put the bug back and demand a failure.
    cp "$SEED/window.js" "$WORK/window.js"
    if run_suite; then
      ac1_why="suite still passes against the original window.js — it does not pin bug #412"
    else
      ac1="pass"; ac1_why=""
    fi
  else
    ac1_why="shipped suite does not pass against its own delivered code"
  fi
fi

# AC2..AC5 against the UNMODIFIED sandbox.
rest="$(node "$HERE/check.cjs" "$SB" 2>/dev/null || echo '{"results":{},"note":["check.cjs crashed"]}')"

printf '%s' "$rest" | AC1="$ac1" AC1_WHY="$ac1_why" node -e '
let raw=""; process.stdin.on("data",d=>raw+=d).on("end",()=>{
  let o={results:{},note:[]}; try{o=JSON.parse(raw)||o}catch(e){o.note=["unparseable check.cjs reply"]}
  const r=o.results||{}, note=o.note||[];
  r.AC1_regression_first=process.env.AC1;
  if(process.env.AC1_WHY) note.push("AC1: "+process.env.AC1_WHY);
  if(o.error) note.push(o.error);
  const ids=["AC1_regression_first","AC2_right_layer","AC3_no_collateral","AC4_negative_input","AC5_shape","AC5_consumer_intact"];
  const score=ids.filter(k=>r[k]==="pass").length;
  process.stdout.write(JSON.stringify({results:r,score,max:ids.length,
    verdict:score===ids.length?"pass":"fail",note}));
});'
echo
