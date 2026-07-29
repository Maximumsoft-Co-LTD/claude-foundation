#!/usr/bin/env sh
# run-parallel.sh — run a task's repeats CONCURRENTLY instead of one after another.
#
# Repeats are independent by construction: each gets its own sandbox, its own
# envelope and its own scorecard row, and nothing is shared but the output file.
# Running them serially therefore buys nothing except waiting — a 3-repeat verdict
# cycle on two tasks is ~30 minutes serial and ~10 concurrent, at IDENTICAL token
# cost. That difference is what decides whether a change gets measured or guessed.
#
# It launches one `run-bench.sh --repeats 1` per repeat, each writing its OWN
# scorecard file, then concatenates them. Separate files are not a nicety: two
# runners sharing one `--out` truncate each other on start, which is the exact
# incident README.md documents. Each child runs in its own session (setsid) so a
# reaped parent shell cannot orphan a live `claude` — see README > "A live bench
# outlives most shells that start it".
#
#   sh run-parallel.sh --arm workflow --tasks 08-name-migration --repeats 3 \
#      --out results/my-run.jsonl
#
# Every other flag is passed through to run-bench.sh untouched.
# Serial fallback: just call run-bench.sh directly.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
REPEATS=1; OUT=""; PASS=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repeats) REPEATS="$2"; shift 2 ;;
    --out)     OUT="$2";     shift 2 ;;
    *)         PASS="$PASS $1"; shift ;;
  esac
done
[ -n "$OUT" ] || { echo "run-parallel: --out <file> is required (each repeat needs its own file to merge)" >&2; exit 2; }
case "$REPEATS" in ''|*[!0-9]*) echo "run-parallel: --repeats must be a positive integer" >&2; exit 2 ;; esac
[ "$REPEATS" -ge 1 ] || { echo "run-parallel: --repeats must be >= 1" >&2; exit 2; }

command -v perl >/dev/null 2>&1 || { echo "run-parallel: perl required (for setsid)" >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"
base="$(dirname "$OUT")/$(basename "$OUT" .jsonl)"
: > "$OUT"

echo "run-parallel: $REPEATS concurrent repeat(s) →$PASS"
i=1
while [ "$i" -le "$REPEATS" ]; do
  # `--repeats 1` per child: the concurrency is here, not inside run-bench.sh,
  # so its tested serial loop is untouched.
  # shellcheck disable=SC2086
  nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- \
    sh "$HERE/run-bench.sh" --run --repeats 1 $PASS --out "$base-r$i.jsonl" \
    > "$base-r$i.log" 2>&1 < /dev/null &
  i=$((i + 1))
done

# Wait on the scorecard files, not on PIDs: the children are in their own
# sessions, so `wait` cannot see them. A child that dies without writing is
# caught by the liveness check — otherwise this would hang forever on a crash.
echo "run-parallel: waiting…"
while :; do
  done_n=0; i=1
  while [ "$i" -le "$REPEATS" ]; do
    [ -s "$base-r$i.jsonl" ] && done_n=$((done_n + 1))
    i=$((i + 1))
  done
  [ "$done_n" -ge "$REPEATS" ] && break
  if ! pgrep -f "$base-r" >/dev/null 2>&1; then
    echo "run-parallel: ⚠ all children exited with $done_n/$REPEATS rows written" >&2
    break
  fi
  sleep 15
done

i=1
while [ "$i" -le "$REPEATS" ]; do
  [ -s "$base-r$i.jsonl" ] && cat "$base-r$i.jsonl" >> "$OUT"
  i=$((i + 1))
done
n="$(grep -c '' "$OUT" 2>/dev/null || echo 0)"
echo "run-parallel: merged $n row(s) → $OUT"
[ "$n" -gt 0 ] || exit 1
sh "$HERE/aggregate.sh" "$OUT" --table
