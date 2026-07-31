#!/usr/bin/env sh
# Deterministic AC oracle for 12-contact-search.
#
#   sh run.sh <sandbox-dir>
#
# AC5 ("the match is tested, including the case-insensitive case and the null-name
# row") cannot be checked by reading the test file — a suite can name those cases
# and still not assert anything that would break. So we do the FAIL_TO_PASS move
# adapted to a feature task: swap the delivered search for the NAIVE implementation
# the task's trap describes (`c.name.includes(q)` — case-sensitive, throws on the
# null row) and demand the suite go red. A suite that stays green would not have
# caught either defect, which is precisely what AC5 asks.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
SB="${1:-}"
[ -n "$SB" ] && [ -d "$SB" ] || { echo '{"error":"usage: run.sh <sandbox-dir>"}'; exit 2; }
command -v node >/dev/null 2>&1 || { echo '{"error":"node not found"}'; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
cp -R "$SB/." "$WORK/" 2>/dev/null || true
rm -rf "$WORK/.git" "$WORK/.workflow" "$WORK/.claude" 2>/dev/null || true

rest="$(node "$HERE/check.cjs" "$SB" 2>/dev/null || echo '{"results":{},"note":["check.cjs crashed"]}')"
target="$(printf '%s' "$rest" | sed -n 's/.*"search":"\([^"]*\)".*/\1/p')"

tests=""
for p in "$WORK"/*.test.js "$WORK"/*.test.cjs "$WORK"/*.test.mjs "$WORK"/*.spec.js \
         "$WORK"/test/*.js "$WORK"/tests/*.js "$WORK"/__tests__/*.js; do
  [ -f "$p" ] || continue
  tests="$tests ${p#"$WORK"/}"
done
# `node --test <dir>` exits 0 while printing "Could not find" on Node 26 — a
# testless sandbox would score as a green suite. Explicit files, run inside $WORK.
run_suite() { ( cd "$WORK" && eval "node --test $tests" >/dev/null 2>&1 ); }

ac5="fail"; ac5_why="no test file shipped"
if [ -z "$target" ]; then
  ac5_why="no search function found to probe"
elif [ -n "$tests" ]; then
  if run_suite; then
    f="${target%%:*}"; n="${target##*:}"
    cat >> "$WORK/$f" <<EOF

/* oracle AC5 probe — naive search injected, appended by the bench, never shipped */
(function () {
  var __lc = (module.exports && module.exports.listContacts) || require("./contacts").listContacts;
  module.exports["$n"] = function (a, b) {
    var q = (b === undefined) ? a : b;
    var list = (b === undefined) ? __lc() : (Array.isArray(a) ? a : __lc());
    return list.filter(function (c) { return c.name.includes(q); });
  };
})();
EOF
    if run_suite; then
      ac5_why="suite stays green against a case-sensitive, null-unsafe search — it tests neither defect"
    else
      ac5="pass"; ac5_why=""
    fi
  else
    ac5_why="shipped suite does not pass against its own delivered code"
  fi
fi

printf '%s' "$rest" | AC5="$ac5" AC5_WHY="$ac5_why" node -e '
let raw=""; process.stdin.on("data",d=>raw+=d).on("end",()=>{
  let o={results:{},note:[]}; try{o=JSON.parse(raw)||o}catch(e){o.note=["unparseable check.cjs reply"]}
  const r=o.results||{}, note=o.note||[];
  r.AC5_match_is_tested=process.env.AC5;
  if(process.env.AC5_WHY) note.push("AC5: "+process.env.AC5_WHY);
  if(o.error) note.push(o.error);
  const ids=["AC1_case_insensitive","AC2_null_safe","AC3_empty_returns_all",
             "AC4_callers_unbroken","AC5_match_is_tested"];
  const score=ids.filter(k=>r[k]==="pass").length;
  process.stdout.write(JSON.stringify({results:r,score,max:ids.length,
    verdict:score===ids.length?"pass":"fail",search:o.search||null,note}));
});'
echo
