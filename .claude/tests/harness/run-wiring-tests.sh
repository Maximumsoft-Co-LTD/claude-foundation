#!/usr/bin/env sh
# Composition-root wiring contract.
#
# Runtime factories take one options object and destructure it. A missing key
# is not a link-time error the way a missing ESM export is — it yields
# `undefined` silently, and the failure surfaces later as "x is not a function"
# at whichever call site first reaches it. `assertOpenSpecCli` reached archive()
# exactly this way. This suite checks statically that every key a factory
# destructures is supplied by foundation.mjs.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

report="$(node "$ROOT/.claude/tests/harness/wiring-check.mjs" "$ROOT")" || {
  fail "wiring check could not run"
  finish "wiring contract tests"
}

if [ "$report" = "OK" ]; then
  pass "every runtime factory parameter is supplied by the composition root"
else
  fail "unsupplied runtime factory parameters:
$report"
fi

# Every runtime module must be reachable from the entrypoint. A module imported
# only by its own test is dead weight that still ships.
unreachable="$(node "$ROOT/.claude/tests/harness/wiring-check.mjs" "$ROOT" --unreferenced)"
if [ "$unreachable" = "OK" ]; then
  pass "every runtime module is reachable from the entrypoint"
else
  fail "runtime modules no shipped code imports:
$unreachable"
fi

finish "wiring contract tests"
