#!/usr/bin/env sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SB="${1:-}"
[ -n "$SB" ] && [ -d "$SB" ] || { echo '{"error":"usage: run.sh <sandbox-dir>"}'; exit 2; }
tests="$(find "$SB" -type f \( -name '*.test.js' -o -name '*.test.mjs' \) 2>/dev/null || true)"
suite="fail"
if [ -n "$tests" ] && (unset NODE_TEST_CONTEXT; cd "$SB" && node --test >/dev/null 2>&1); then suite="pass"; fi
behavior="$(node "$HERE/check.mjs" "$SB" 2>/dev/null || echo '{"results":{}}')"
printf '%s' "$behavior" | SUITE="$suite" node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{let o={results:{}};try{o=JSON.parse(raw)}catch{};
o.results.CASE_CHARACTERIZATION_TESTS=process.env.SUITE;const ids=Object.keys(o.results);
const score=ids.filter(id=>o.results[id]==="pass").length;process.stdout.write(JSON.stringify({results:o.results,
score,max:ids.length,verdict:score===ids.length?"pass":"fail"})+"\n")})'
