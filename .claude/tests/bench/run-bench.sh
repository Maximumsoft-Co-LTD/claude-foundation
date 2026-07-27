#!/usr/bin/env sh
# run-bench.sh — the live efficiency benchmark. For each task and arm, it runs
# the task in a fresh sandbox, captures the cost envelope (tokens/$/turns/ms) plus
# the workflow's own mechanism telemetry (state.json: spawn_count, cycles), grades
# the delivered code with judge-outcome.sh, and appends one scorecard row per run.
# aggregate.sh + compare.sh then turn the rows into medians and a verdict.
#
# Two arms per task:
#   workflow  — sandbox has the /dev machinery; the prompt drives `/dev`.
#   baseline  — a bare repo, plain "just build it" prompt, no workflow.
# The outcome judge grades only the code diff (excludes .workflow/.claude), so the
# arms compare fairly — that's the A/B "is the machinery worth it?" measurement.
#
# NON-DETERMINISTIC + COSTS TOKENS. Dry-run by default. The comparison MATH is
# unit-tested separately (tests/run-bench-tests.sh) with no tokens.
#
#   sh run-bench.sh                          # dry-run: print the plan
#   sh run-bench.sh --run                    # live (needs claude CLI + jq)
#   sh run-bench.sh --run --repeats 3        # 3 repeats/arm for stable medians
#   sh run-bench.sh --run --arm workflow     # workflow arm only (skip A/B)
#   sh run-bench.sh --run --tasks 01-task-list
#
# Same interview caveat as e2e: a /dev run that stalls on AskUserQuestion times
# out and its row is marked ok=false; the prompts are written to avoid it.
# An optional tasks/<name>/seed/ dir is copied into BOTH arms' sandboxes before
# the run (for brownfield tasks that need starter code); absent => empty sandbox.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
TASKS="$HERE/tasks"
DEVMETRICS="$ROOT/.claude/orchestrator/references/dev-metrics.sh"
RESULTS="$HERE/results"
OUT="$RESULTS/scorecards.jsonl"
MODEL="${BENCH_MODEL:-sonnet}"
TIMEOUT_S="${BENCH_TIMEOUT:-1800}"   # watchdog ceiling per run; a full /dev arm can need most of this

MODE="dry"; REPEATS=1; ARMSEL="both"; KEEP=0; TASKSEL=""
[ "${BENCH_RUN:-0}" = "1" ] && MODE="run"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) MODE="run" ;;
    --dry-run) MODE="dry" ;;
    --repeats) REPEATS="$2"; shift ;;
    --arm) ARMSEL="$2"; shift ;;
    --tasks) TASKSEL="$2"; shift ;;
    --keep) KEEP=1 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$ARMSEL" in workflow) ARMS="workflow" ;; baseline) ARMS="baseline" ;; *) ARMS="workflow baseline" ;; esac

task_dirs() {
  for d in "$TASKS"/*/; do
    [ -d "$d" ] || continue
    n="$(basename "$d")"
    [ -n "$TASKSEL" ] && [ "$n" != "$TASKSEL" ] && continue
    echo "$n"
  done
}

# ---- dry-run ---------------------------------------------------------------
if [ "$MODE" = "dry" ]; then
  echo "bench plan — model=$MODEL repeats=$REPEATS arms=[$ARMS]"
  total=0
  for n in $(task_dirs); do
    echo "• task $n  (acceptance: $(head -c 60 "$TASKS/$n/acceptance.txt" 2>/dev/null)…)"
    for a in $ARMS; do
      echo "    arm=$a × $REPEATS  → sandbox + claude -p --output-format json + judge-outcome"
      total=$((total + REPEATS))
    done
  done
  echo
  echo "bench (dry-run): $total live run(s) planned. Re-run with --run (needs the claude CLI)."
  echo "Comparison math is already proven: sh tests/run-bench-tests.sh"
  exit 0
fi

# ---- live ------------------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  echo "bench: SKIP — no \`claude\` CLI on PATH." >&2; exit 0
fi
command -v jq >/dev/null 2>&1 || { echo "bench: jq required" >&2; exit 2; }

mkdir -p "$RESULTS"
: > "$OUT"
PROG="$RESULTS/progress.txt"

# Total units + a live percent counter. progress() overwrites PROG (pollable via
# `cat`/`tail -f`) and echoes, so a watcher sees "[k/N pct%] label" climb.
TCOUNT=0; for _n in $(task_dirs); do TCOUNT=$((TCOUNT + 1)); done
ACOUNT=0; for _a in $ARMS; do ACOUNT=$((ACOUNT + 1)); done
TOTAL=$(( TCOUNT * ACOUNT * REPEATS )); [ "$TOTAL" -gt 0 ] || TOTAL=1
DONE=0
progress() {
  pct=$(( DONE * 100 / TOTAL ))
  msg="[$DONE/$TOTAL ${pct}%] $1"
  echo ">> $msg"
  printf '%s\n' "$msg" > "$PROG"
}

# Portable watchdog (no `timeout` binary here): run the captured command in the
# background, kill it after N seconds so a stalled interview can't hang the run.
# $1 secs · $2 outfile · $3 sandbox · $4 prompt-file
run_capture() {
  ( cd "$3" && claude -p "$(cat "$4")" --output-format json --dangerously-skip-permissions --model "$MODEL" ) >"$2" 2>/dev/null &
  cpid=$!
  ( sleep "$1"; kill -TERM "$cpid" 2>/dev/null; sleep 3; kill -KILL "$cpid" 2>/dev/null ) &
  wpid=$!
  wait "$cpid" 2>/dev/null; rc=$?
  kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null
  return "$rc"
}

echo "progress file: $PROG   (watch live: tail -f $RESULTS/run.log  |  cat $PROG)"
progress "starting — $TOTAL unit(s)"
SANDROOT="$(mktemp -d)"
cleanup() { [ "$KEEP" = "1" ] && echo "sandboxes kept under $SANDROOT" || rm -rf "$SANDROOT"; }
trap cleanup EXIT INT TERM

git_base() { ( cd "$1" && git init -q && git add -A && git -c user.email=b@bench -c user.name=bench commit -qm base >/dev/null 2>&1 ); }

setup_workflow() {  # $1 sandbox, $2 task
  s="$1"; t="$2"; mkdir -p "$s/.workflow"
  cp -R "$ROOT/.claude" "$s/.claude"
  [ -f "$ROOT/WORKFLOW.md" ] && cp "$ROOT/WORKFLOW.md" "$s/WORKFLOW.md"
  [ -f "$ROOT/CLAUDE.md" ]   && cp "$ROOT/CLAUDE.md"   "$s/CLAUDE.md"
  cp -R "$ROOT/.workflow/_templates" "$s/.workflow/_templates"
  if [ -f "$ROOT/.workflow/INDEX.md" ]; then cp "$ROOT/.workflow/INDEX.md" "$s/.workflow/INDEX.md"
  else printf '# Index\n\n| ID | Type | Title | Status | Created | Updated |\n|----|------|-------|--------|---------|---------|\n' > "$s/.workflow/INDEX.md"; fi
  [ -d "$TASKS/$t/seed" ] && cp -R "$TASKS/$t/seed/." "$s/"
  git_base "$s"
}
setup_baseline() {  # $1 sandbox, $2 task — bare repo, no workflow
  s="$1"; t="$2"; mkdir -p "$s"
  [ -d "$TASKS/$t/seed" ] && cp -R "$TASKS/$t/seed/." "$s/"
  printf '# sandbox\n' > "$s/README.md"
  git_base "$s"
}

emit() {  # all values already JSON-literal-safe strings ("null" when absent)
  jq -cn \
    --arg task "$1" --arg arm "$2" --argjson repeat "$3" --argjson ok "$4" \
    --argjson cost "$5" --argjson intok "$6" --argjson outtok "$7" --argjson turns "$8" --argjson dur "$9" \
    --argjson spawn "${10}" --argjson cyt "${11}" --argjson cyr "${12}" --argjson skip "${13}" \
    --argjson jscore "${14}" --arg jverd "${15}" --argjson wall "${16}" \
    '{task:$task, arm:$arm, repeat:$repeat, ok:$ok, cost_usd:$cost, in_tokens:$intok, out_tokens:$outtok, turns:$turns, duration_ms:$dur, wall_s:$wall, spawn_count:$spawn, cycles_test:$cyt, cycles_review:$cyr, skipped:$skip, judge_score:$jscore, judge_verdict:$jverd}' >> "$OUT"
}

runs=0
for n in $(task_dirs); do
  acc="$TASKS/$n/acceptance.txt"
  for a in $ARMS; do
    prompt_file="$TASKS/$n/$a.txt"
    [ -f "$prompt_file" ] || { echo "   (no $a.txt for $n — skip)"; continue; }
    r=1
    while [ "$r" -le "$REPEATS" ]; do
      progress "$n · arm=$a · run $r/$REPEATS — launching claude (≤${TIMEOUT_S}s)"
      sb="$SANDROOT/$n-$a-$r"
      if [ "$a" = "workflow" ]; then setup_workflow "$sb" "$n"; else setup_baseline "$sb" "$n"; fi
      base_sha="$(git -C "$sb" rev-parse HEAD 2>/dev/null || echo HEAD)"   # judge diffs against this (survives a /dev commit)

      # Real wall-clock — the envelope's duration_ms only counts the top session,
      # not sub-agent spawns, so it wildly under-reports a /dev run (65s vs a true
      # 13min). Measure it ourselves; this is the honest time axis.
      t0="$(date +%s 2>/dev/null || echo 0)"
      run_capture "$TIMEOUT_S" "$sb/.bench-envelope.json" "$sb" "$prompt_file" || echo "   ! run exited nonzero (watchdog kill or error)"
      wall_s=$(( $(date +%s 2>/dev/null || echo 0) - t0 ))
      envj="$(cat "$sb/.bench-envelope.json" 2>/dev/null || true)"
      ok=false; cost=null; intok=null; outtok=null; turns=null; dur=null
      if [ -n "$envj" ] && printf '%s' "$envj" | jq -e . >/dev/null 2>&1; then
        # `--output-format json` may be a single result object OR a stream array
        # (CLI-version dependent) — normalize to the result object either way.
        robj="$(printf '%s' "$envj" | jq -c 'if type=="array" then ((map(select(.type=="result")) | last) // .[-1] // {}) else . end' 2>/dev/null || printf '{}')"
        [ -n "$robj" ] || robj='{}'
        # _get: read a field, always yield a JSON-literal ("null" on miss/error)
        # so the later --argjson never sees an empty string.
        _get() { _v="$(printf '%s' "$robj" | jq -r "($1) // \"null\"" 2>/dev/null || true)"; [ -n "$_v" ] && printf '%s' "$_v" || printf 'null'; }
        printf '%s' "$robj" | jq -e '.is_error == true' >/dev/null 2>&1 && ok=false || ok=true
        cost="$(_get '.total_cost_usd // .cost_usd')"
        intok="$(_get '.usage.input_tokens')"
        outtok="$(_get '.usage.output_tokens')"
        turns="$(_get '.num_turns')"
        dur="$(_get '.duration_ms')"
      else
        echo "   ! claude run produced no JSON envelope (timeout/stall)"
      fi

      spawn=null; cyt=null; cyr=null; skip=null
      if [ "$a" = "workflow" ]; then
        rd="$(find "$sb/.workflow" -mindepth 1 -maxdepth 1 -type d ! -name _templates 2>/dev/null | head -n1)"
        if [ -n "$rd" ] && [ -f "$rd/state.json" ]; then
          spawn="$(jq -r '.spawn_count // "null"' "$rd/state.json")"
          cyt="$(jq -r '.cycles.test // "null"' "$rd/state.json")"
          cyr="$(jq -r '.cycles.review // "null"' "$rd/state.json")"
          skip="$(jq -r '(.skipped_steps // []) | length' "$rd/state.json")"
          [ -f "$DEVMETRICS" ] && sh "$DEVMETRICS" "$rd" 2>/dev/null | sed 's/^/     /' || true
        fi
      fi

      jscore=null; jverd=skip
      jout="$(sh "$HERE/judge-outcome.sh" "$sb" "$acc" --base "$base_sha" --model "$MODEL" 2>/dev/null || true)"
      if [ -n "$jout" ] && printf '%s' "$jout" | jq -e . >/dev/null 2>&1; then
        jscore="$(printf '%s' "$jout" | jq -r '.score // "null"')"
        jverd="$(printf '%s' "$jout"  | jq -r '.verdict // "skip"')"
        echo "   judge-outcome: score=$jscore verdict=$jverd"
      else
        echo "   judge-outcome: skipped"
      fi

      emit "$n" "$a" "$r" "$ok" "$cost" "$intok" "$outtok" "$turns" "$dur" "$spawn" "$cyt" "$cyr" "$skip" "$jscore" "$jverd" "${wall_s:-null}"
      runs=$((runs + 1)); DONE=$((DONE + 1)); r=$((r + 1))
      progress "$n · arm=$a done — ok=$ok cost=\$$cost judge=$jscore/$jverd"
    done
  done
done

echo
echo "scorecards → $OUT ($runs rows)"
echo
echo "════ aggregate (median per task/arm) ════"
sh "$HERE/aggregate.sh" "$OUT" --table
if printf '%s' "$ARMS" | grep -q workflow && printf '%s' "$ARMS" | grep -q baseline; then
  echo; echo "════ A/B verdict ════"; sh "$HERE/compare.sh" --ab "$OUT"
fi
echo
echo "Set a ratchet baseline:  cp $OUT $HERE/baselines/<name>.jsonl"
echo "Guard a later run:       sh $HERE/compare.sh --ratchet $HERE/baselines/<name>.jsonl $OUT"
