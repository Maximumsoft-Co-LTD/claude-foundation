#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
SCENARIOS="${CF_DIAGNOSTIC_SCENARIOS:-$HERE/scenarios-20.tsv}"
RUN_ROOT="${CF_DIAGNOSTIC_ROOT:-$(mktemp -d /tmp/claude-foundation-20probe.XXXXXX)}"
MODEL="${CF_DIAGNOSTIC_MODEL:-sonnet}"
BUDGET="${CF_DIAGNOSTIC_BUDGET_USD:-2}"
JOBS="${CF_DIAGNOSTIC_JOBS:-5}"
TIMEOUT_S="${CF_DIAGNOSTIC_TIMEOUT:-1200}"
TAGS="${CF_DIAGNOSTIC_TAGS:-v3.2.19}"
MODE="dry"

[ "${CF_DIAGNOSTIC_RUN:-0}" = "1" ] && MODE="run"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) MODE="run" ;;
    --dry-run) MODE="dry" ;;
    --root) RUN_ROOT="$2"; shift ;;
    --jobs) JOBS="$2"; shift ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$RUN_ROOT/results" "$RUN_ROOT/sandboxes"
git -C "$ROOT" rev-parse HEAD > "$RUN_ROOT/source-head.txt"
git -C "$ROOT" status --porcelain=v2 > "$RUN_ROOT/source-status.txt"
git -C "$ROOT" diff HEAD --binary --output="$RUN_ROOT/worktree.patch"
git -C "$ROOT" ls-files --others --exclude-standard > "$RUN_ROOT/untracked.txt"

if [ "$MODE" = "run" ] && [ -s "$RUN_ROOT/source-status.txt" ]; then
  printf 'refusing a live diagnostic run from a dirty source checkout\n' >&2
  exit 1
fi

count="$(awk -F '\t' 'NF >= 3 && $1 !~ /^#/ {n++} END {print n+0}' "$SCENARIOS")"
printf 'diagnostic probes: mode=%s scenarios=%s model=%s budget=$%s jobs=%s root=%s\n' \
  "$MODE" "$count" "$MODEL" "$BUDGET" "$JOBS" "$RUN_ROOT"
[ "$MODE" = "run" ] || exit 0
[ "$count" -eq 20 ] || { printf 'expected exactly 20 scenarios, found %s\n' "$count" >&2; exit 1; }
for dependency in claude git node tar; do
  command -v "$dependency" >/dev/null 2>&1 || {
    printf 'required diagnostic command is missing: %s\n' "$dependency" >&2
    exit 1
  }
done
claude --version > "$RUN_ROOT/claude-version.txt"

SOURCE_HEAD="$(sed -n '1p' "$RUN_ROOT/source-head.txt")"
PIDS=""
ACTIVE=0

terminate_children() {
  for pid in $PIDS; do kill -TERM "$pid" 2>/dev/null || true; done
}
trap terminate_children INT TERM

run_one() {
  local id="$1" hypothesis="$2" verify="$3"
  local sandbox="$RUN_ROOT/sandboxes/$id" result="$RUN_ROOT/results/$id"
  mkdir -p "$sandbox" "$result"
  git -C "$ROOT" archive "$SOURCE_HEAD" | tar -x -C "$sandbox"
  git -C "$sandbox" init -q
  git -C "$sandbox" -c user.email=e2e@example.invalid -c user.name=e2e add -A
  git -C "$sandbox" -c user.email=e2e@example.invalid -c user.name=e2e commit -qm snapshot
  for tag in $TAGS; do
    git -C "$ROOT" rev-parse --verify -q "refs/tags/$tag" >/dev/null || {
      printf 'required diagnostic tag is missing: %s\n' "$tag" >&2
      return 1
    }
    git -C "$sandbox" fetch --quiet --depth=1 "$ROOT" \
      "refs/tags/$tag:refs/tags/$tag"
  done
  verify="${verify#.}"
  printf '%s\n' "$hypothesis" > "$result/hypothesis.txt"
  printf '%s\n' "$verify" > "$result/suggested-command.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$result/start.txt"

  local prompt
  prompt="You are probe $id of a 20-scenario end-to-end diagnostic of the Foundation harness. This is an isolated disposable snapshot at $SOURCE_HEAD; never commit, push, or touch another checkout.

Hypothesis: $hypothesis
Suggested focused verification: $verify

Inspect the relevant production code and tests. Run focused deterministic tests, including a negative or boundary case that actually exercises the hypothesis. Do not run the Foundation /dev ceremony; this session is itself an external diagnostic. If you reproduce a real product or test defect, make the smallest candidate fix and regression test only in this disposable snapshot, then rerun the failing check. Do not claim a defect from prose or code inspection alone. Finish with exactly these headings: VERDICT (PASS, FAIL_FIXED, FAIL_UNFIXED, or INCONCLUSIVE), COMMANDS, EVIDENCE, DEFECTS, HARNESS_IMPROVEMENTS."

  set +e
  (
    cd "$sandbox" || exit 97
    env -u CLAUDECODE claude -p "$prompt" \
      --dangerously-skip-permissions --model "$MODEL" \
      --output-format json --max-budget-usd "$BUDGET" \
      --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
      --setting-sources project,local
  ) > "$result/claude.json" 2> "$result/stderr.log" &
  local claude_pid=$!
  (
    elapsed=0
    while kill -0 "$claude_pid" 2>/dev/null && [ "$elapsed" -lt "$TIMEOUT_S" ]; do
      sleep 1
      elapsed=$((elapsed + 1))
    done
    if kill -0 "$claude_pid" 2>/dev/null; then
      kill -TERM "$claude_pid" 2>/dev/null
      sleep 5
      kill -KILL "$claude_pid" 2>/dev/null
    fi
  ) &
  local watch_pid=$!
  wait "$claude_pid"; local rc=$?
  wait "$watch_pid" 2>/dev/null
  set -e

  printf '%s\n' "$rc" > "$result/exit-code.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$result/end.txt"
  git -C "$sandbox" diff --binary --output="$result/sandbox.patch"
  git -C "$sandbox" status --short > "$result/status.txt"
}

while IFS=$'\t' read -r id hypothesis verify; do
  [ -n "$id" ] || continue
  case "$id" in \#*) continue ;; esac
  run_one "$id" "$hypothesis" "$verify" &
  PIDS="$PIDS $!"
  ACTIVE=$((ACTIVE + 1))
  if [ "$ACTIVE" -ge "$JOBS" ]; then
    for pid in $PIDS; do wait "$pid" || true; done
    PIDS=""
    ACTIVE=0
  fi
done < "$SCENARIOS"

for pid in $PIDS; do wait "$pid" || true; done
node "$HERE/analyze-results.mjs" "$RUN_ROOT"
printf 'diagnostic probes complete: %s\n' "$RUN_ROOT"
