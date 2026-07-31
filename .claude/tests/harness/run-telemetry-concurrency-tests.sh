#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/harness" "$TMP/project/openspec"
cp "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp -R "$ROOT/openspec/schemas" "$TMP/project/openspec/"
cp "$ROOT/openspec/config.yaml" "$TMP/project/openspec/"
cp "$ROOT/foundation.json" "$TMP/project/"
printf 'initial\n' > "$TMP/project/app.txt"
cd "$TMP/project"

RUNTIME=".claude/harness/foundation.mjs"
node "$RUNTIME" new 'Concurrent context telemetry' --rapid >/dev/null
node "$RUNTIME" resolve concurrent-context-telemetry \
  --impact low --coupling isolated >/dev/null

pids=""
i=1
while [ "$i" -le 20 ]; do
  node "$RUNTIME" packet concurrent-context-telemetry \
    > "$TMP/packet-$i.json" &
  pids="$pids $!"
  i=$((i + 1))
done
for pid in $pids; do wait "$pid"; done

events=".foundation/logs/concurrent-context-telemetry/context-events"
assert_eq "concurrent packet calls retain every context event" "20" \
  "$(find "$events" -type f -name '*.json' | wc -l | tr -d ' ')"
assert_cmd_zero "every concurrent event is valid JSON" sh -c \
  'for f in "$1"/*.json; do jq -e . "$f" >/dev/null || exit 1; done' _ "$events"

printf 'not-json\n' > \
  .foundation/logs/concurrent-context-telemetry/context.jsonl
assert_cmd_zero "metrics tolerates a malformed legacy context row" \
  node "$RUNTIME" metrics concurrent-context-telemetry

chmod 500 "$events"
if node "$RUNTIME" packet concurrent-context-telemetry >/dev/null 2>&1; then
  pass "context telemetry failure cannot block packet output"
else
  fail "context telemetry failure cannot block packet output"
fi
chmod 700 "$events"

node - "$events" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
for (let index = 0; index < 1001; index += 1)
  fs.writeFileSync(path.join(dir, `seed-${String(index).padStart(4, "0")}.json`),
    JSON.stringify({ version: 2, kind: "seed", bytes: 10 }));
NODE
node "$RUNTIME" packet concurrent-context-telemetry >/dev/null
retained="$(find "$events" -type f -name '*.json' | wc -l | tr -d ' ')"
if [ "$retained" -le 522 ]; then
  pass "context events roll into a bounded retained set"
else
  fail "context events roll into a bounded retained set — retained $retained"
fi
assert_eq "rollup accounts for compacted events" "500" \
  "$(jq -r '.count' .foundation/logs/concurrent-context-telemetry/context-rollup.json)"

finish "telemetry concurrency"
