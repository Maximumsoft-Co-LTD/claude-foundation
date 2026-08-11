#!/usr/bin/env sh
# Shipped runtime wiring contract.
#
# Runtime factories take one options object and destructure it. A missing key
# is not a link-time error the way a missing ESM export is — it yields
# `undefined` silently, and the failure surfaces later as "x is not a function"
# at whichever call site first reaches it. `assertOpenSpecCli` reached archive()
# exactly this way. This suite checks statically that every key a factory
# destructures is supplied by its shipped caller.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

report="$(node "$ROOT/.claude/tests/harness/wiring-check.mjs" "$ROOT")" || {
  fail "wiring check could not run"
  finish "wiring contract tests"
}

if [ "$report" = "OK" ]; then
  pass "every runtime factory parameter is supplied by shipped runtime code"
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

# A callback that closes over a runtime assigned later makes initialization
# order a convention rather than a checked property. Every runtime/topology
# factory must be constructed into a const after its dependencies exist.
late_bindings="$(node "$ROOT/.claude/tests/harness/wiring-check.mjs" "$ROOT" --late-bindings)"
if [ "$late_bindings" = "OK" ]; then
  pass "runtime factories are initialized in dependency order"
else
  fail "delayed runtime bindings remain:
$late_bindings"
fi

finish "wiring contract tests"
