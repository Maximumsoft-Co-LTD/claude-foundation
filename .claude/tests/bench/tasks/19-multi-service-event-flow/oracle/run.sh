#!/usr/bin/env sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SEED="$HERE/../seed"
SB="${1:-}"
[ -n "$SB" ] && [ -d "$SB" ] || { echo '{"error":"usage: run.sh <sandbox-dir>"}'; exit 2; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT INT TERM
cp -R "$SB/." "$WORK/"; rm -rf "$WORK/.git" "$WORK/.claude" "$WORK/.foundation" "$WORK/openspec"
tests="$(find "$WORK" -type f \( -name '*.test.js' -o -name '*.test.mjs' \) 2>/dev/null || true)"
regression="fail"
run_suite() { (unset NODE_TEST_CONTEXT; cd "$WORK" && node --test >/dev/null 2>&1); }
if [ -n "$tests" ] && run_suite; then
  cp "$SEED/services/orders/order-event.mjs" "$WORK/services/orders/order-event.mjs"
  if ! run_suite; then regression="pass"; fi
fi
behavior="$(node "$HERE/check.mjs" "$SB" 2>/dev/null || echo '{"results":{}}')"
printf '%s' "$behavior" | REGRESSION="$regression" node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{let o={results:{}};try{o=JSON.parse(raw)}catch{};
o.results.CASE_CONTRACT_TEST=process.env.REGRESSION;const ids=Object.keys(o.results);
const score=ids.filter(id=>o.results[id]==="pass").length;process.stdout.write(JSON.stringify({results:o.results,
score,max:ids.length,verdict:score===ids.length?"pass":"fail"})+"\n")})'
