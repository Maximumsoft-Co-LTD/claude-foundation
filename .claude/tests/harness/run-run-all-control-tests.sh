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

# kill -0 also succeeds for a zombie, and when the TERMed parent dies before
# reaping, the dead child reparents to pid 1 — which containers often never
# reap. Only a non-Z state means kill_tree actually left it running.
child_running() {
  _state="$(ps -o state= -p "$1" 2>/dev/null | tr -d ' ')"
  [ -n "$_state" ] && [ "$_state" != "Z" ]
}
tries=0
while child_running "$child" && [ "$tries" -lt 50 ]; do
  sleep 0.02
  tries=$((tries + 1))
done
if child_running "$child"; then
  echo "FAIL: run-all left a descendant process alive"
  exit 1
fi

echo "run-all process control: PASS"
