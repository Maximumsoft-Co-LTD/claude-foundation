#!/usr/bin/env sh
# Hidden oracle for 23-project-tracker-api: drives createServer({ dataFile, now }) over HTTP on
# an ephemeral port with a temp data file and injected clock, then checks the
# delivered suite.
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
# Product code may log to stdout; the verdict is always the final line.
out="$(node "$HERE/check.mjs" "$WORK" "$SEED" 2>/dev/null | tail -n 1 || true)"
case "$out" in
  '{"results"'*) printf '%s\n' "$out" ;;
  *) printf '%s\n' '{"results":{"CASE_ORACLE_COMPLETED":"fail"},"score":0,"max":1,"verdict":"fail"}' ;;
esac
