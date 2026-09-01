#!/usr/bin/env sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
SEED="$HERE/../seed"
SB="${1:-}"
[ -n "$SB" ] && [ -d "$SB" ] || { echo '{"error":"usage: run.sh <sandbox-dir>"}'; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
cp -R "$SB/." "$WORK/"
rm -rf "$WORK/.git" "$WORK/.claude" "$WORK/.foundation" "$WORK/openspec"

tests="$(find "$WORK/tests" -type f -name 'test_*.py' 2>/dev/null || true)"
ac1="fail"
if [ -n "$tests" ] && (cd "$WORK" && python3 -m unittest discover -s tests >/dev/null 2>&1); then
  cp "$SEED/user_api.py" "$WORK/user_api.py"
  if ! (cd "$WORK" && python3 -m unittest discover -s tests >/dev/null 2>&1); then
    ac1="pass"
  fi
fi

AC1="$ac1" python3 "$HERE/check.py" "$SB"
