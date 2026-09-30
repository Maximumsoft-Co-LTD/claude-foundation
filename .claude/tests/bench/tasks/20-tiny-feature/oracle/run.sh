#!/usr/bin/env sh
# Deterministic oracle for 20-tiny-feature: discount(total, percent) exists,
# throws RangeError outside 0-100, and the shipped suite passes and exercises it.
#
#   sh run.sh <sandbox-dir>
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SEED="$HERE/../seed"
SB="${1:-}"
[ -n "$SB" ] && [ -d "$SB" ] || { echo '{"error":"usage: run.sh <sandbox-dir>"}'; exit 2; }
command -v node >/dev/null 2>&1 || { echo '{"error":"node not found"}'; exit 2; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT INT TERM
cp -R "$SB/." "$WORK/"; rm -rf "$WORK/.git" "$WORK/.claude" "$WORK/.foundation" "$WORK/openspec"
# `node --test` with no discoverable files still exits 0, so require real files.
tests="$(find "$WORK" -path "$WORK/node_modules" -prune -o -type f \
  \( -name '*.test.js' -o -name '*.test.cjs' -o -name '*.test.mjs' \) -print 2>/dev/null || true)"
run_suite() { (unset NODE_TEST_CONTEXT; cd "$WORK" && node --test >/dev/null 2>&1); }
suite="fail"; covered="fail"
if [ -n "$tests" ] && run_suite; then
  suite="pass"
  # The suite must exercise discount: against the original cart.js it has to fail.
  cp "$SEED/src/cart.js" "$WORK/src/cart.js"
  if ! run_suite; then covered="pass"; fi
fi
behavior="$(node "$HERE/check.cjs" "$SB" 2>/dev/null || echo '{"results":{}}')"
printf '%s' "$behavior" | SUITE="$suite" COVERED="$covered" node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{let o={results:{}};try{o=JSON.parse(raw)}catch{};
o.results.CASE_TESTS_PASS=process.env.SUITE;o.results.CASE_TESTS_COVER_DISCOUNT=process.env.COVERED;
const ids=Object.keys(o.results);const score=ids.filter(id=>o.results[id]==="pass").length;
process.stdout.write(JSON.stringify({results:o.results,score,max:ids.length,
verdict:score===ids.length?"pass":"fail"})+"\n")})'
