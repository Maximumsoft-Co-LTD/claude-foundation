#!/usr/bin/env sh
# Deterministic AC oracle for 13-money-drift.
#
#   sh run.sh <sandbox-dir>
#
# AC6 is the SWE-bench FAIL_TO_PASS contract: the shipped suite must pass on the
# delivered tree AND fail once the whole original defect surface is restored. We
# restore every seed file EXCEPT the delivered tests — a suite that stays green
# against the original code did not pin either reported defect, however thorough
# it reads. AC1..AC5, AC7 are direct assertions (check.cjs).
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

tests=""
for p in "$WORK"/*.test.js "$WORK"/*.test.cjs "$WORK"/*.test.mjs "$WORK"/*.spec.js \
         "$WORK"/test/*.js "$WORK"/tests/*.js "$WORK"/__tests__/*.js; do
  [ -f "$p" ] || continue
  tests="$tests ${p#"$WORK"/}"
done

# `node --test <dir>` exits 0 while printing "Could not find" on Node 26, which
# would score a testless sandbox as green. Explicit files, run from inside $WORK.
run_suite() { ( cd "$WORK" && eval "node --test $tests" >/dev/null 2>&1 ); }

ac6="fail"; ac6_why="no test file shipped"
if [ -n "$tests" ]; then
  if run_suite; then
    for f in money.js cart.js discounts.js invoice.js report.js orders.json; do
      [ -f "$SEED/$f" ] && cp "$SEED/$f" "$WORK/$f"
    done
    if run_suite; then
      ac6_why="suite still passes against the original code — it pins neither reported defect"
    else
      ac6="pass"; ac6_why=""
    fi
  else
    ac6_why="shipped suite does not pass against its own delivered code"
  fi
fi

rest="$(node "$HERE/check.cjs" "$SB" 2>/dev/null || echo '{"results":{},"note":["check.cjs crashed"]}')"

printf '%s' "$rest" | AC6="$ac6" AC6_WHY="$ac6_why" node -e '
let raw=""; process.stdin.on("data",d=>raw+=d).on("end",()=>{
  let o={results:{},note:[]}; try{o=JSON.parse(raw)||o}catch(e){o.note=["unparseable check.cjs reply"]}
  const r=o.results||{}, note=o.note||[];
  r.AC6_pinned_by_tests=process.env.AC6;
  if(process.env.AC6_WHY) note.push("AC6: "+process.env.AC6_WHY);
  if(o.error) note.push(o.error);
  const ids=["AC1_right_layer","AC2_reconciles","AC3_discount_once","AC4_public_shapes",
             "AC5_persisted_data","AC6_pinned_by_tests","AC7_no_collateral"];
  const score=ids.filter(k=>r[k]==="pass").length;
  process.stdout.write(JSON.stringify({results:r,score,max:ids.length,
    verdict:score===ids.length?"pass":"fail",note}));
});'
echo
