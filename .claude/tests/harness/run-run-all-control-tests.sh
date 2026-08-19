#!/usr/bin/env sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
RUN_ALL="$HERE/../run-all.sh"
WORK="$(mktemp -d)"
parent=""

cleanup() {
  [ -n "$parent" ] && kill -KILL "$parent" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT HUP INT TERM

sh -c 'sleep 60 & echo "$!" > "$1"; wait' sh "$WORK/child.pid" 2>/dev/null &
parent=$!
tries=0
while [ ! -s "$WORK/child.pid" ] && [ "$tries" -lt 50 ]; do
  sleep 0.02
  tries=$((tries + 1))
done
[ -s "$WORK/child.pid" ] || { echo "FAIL: child PID was not recorded"; exit 1; }
child="$(cat "$WORK/child.pid")"

sh "$RUN_ALL" --kill-tree "$parent"
wait "$parent" 2>/dev/null || true
parent=""

tries=0
while kill -0 "$child" 2>/dev/null && [ "$tries" -lt 50 ]; do
  sleep 0.02
  tries=$((tries + 1))
done
if kill -0 "$child" 2>/dev/null; then
  echo "FAIL: run-all left a descendant process alive"
  exit 1
fi

echo "run-all process control: PASS"
