#!/usr/bin/env sh
# run-bench.sh — the live efficiency benchmark. For each task and arm, it runs
# the task in a fresh sandbox, captures the cost envelope (tokens/$/turns/ms) plus
# the workflow's own mechanism telemetry (state.json: spawn_count, cycles), grades
# the delivered code with judge-outcome.sh, and appends one scorecard row per run.
# aggregate.sh + compare.sh then turn the rows into medians and a verdict.
#
# Three arms per task:
#   workflow  — sandbox has the /dev machinery; the prompt drives `/dev`.
#   baseline  — a bare repo, plain "just build it" prompt, no workflow.
#   design    — `/dev --yes --plan-only`: Phase 1 only, stops at the gate. ~a third
#               of a full run's cost and wall, because Design alone is 39-49% of a
#               brownfield-S run. Graded DETERMINISTICALLY by grade-design.sh (no
#               model, no tokens, no variance) on whether the design set is complete
#               and self-consistent. It CANNOT see whether the spec caught unstated
#               requirements — only delivered code shows that — so use it to iterate
#               on structural changes and confirm with the workflow arm.
# The outcome judge grades only the code diff (excludes .workflow/.claude), so the
# workflow/baseline arms compare fairly — that's the A/B "is the machinery worth
# it?" measurement. The design arm is not part of that A/B; it has no code.
#
# NON-DETERMINISTIC + COSTS TOKENS. Dry-run by default. The comparison MATH is
# unit-tested separately (tests/run-bench-tests.sh) with no tokens.
#
#   sh run-bench.sh                          # dry-run: print the plan
#   sh run-bench.sh --run                    # live (needs claude CLI + jq)
#   sh run-bench.sh --run --repeats 3        # 3 repeats/arm for stable medians
#   sh run-bench.sh --run --arm workflow     # workflow arm only (skip A/B)
#   sh run-bench.sh --run --arm design       # Phase-1 only: fast iteration loop
#   sh run-bench.sh --run --tasks 01-task-list
#
# Same interview caveat as e2e: a /dev run that stalls on AskUserQuestion times
# out and its row is marked ok=false; the prompts are written to avoid it.
# An optional tasks/<name>/seed/ dir is copied into BOTH arms' sandboxes before
# the run (for brownfield tasks that need starter code); absent => empty sandbox.
#
# A failed row also carries `fail_reason`, because "the workflow wrote bad code"
# and "we killed the run at the watchdog" are different problems that a bare
# ok=false conflates. It happened for real: a /dev arm hit the 1800s ceiling, the
# judge then graded a half-built sandbox at 3/fail, and the scorecard read like a
# quality regression. The reasons:
#   timeout      — the watchdog ended it; nothing here grades the workflow
#   no_envelope  — exited without emitting JSON (stall / crash)
#   api_error    — the envelope itself reports is_error
#   exit_<n>     — exited nonzero on its own, envelope still parsed
# aggregate.sh keeps these rows out of every median and reports the tally.
#
# ---- FOUR AXES, AND WHAT EACH ROW NOW CARRIES ------------------------------
# The scorecard measures quality, speed, cost and CONTEXT. Three of those were
# already here; the fourth was the gap that made the other three hard to reason
# about, and two of the three were carrying fields that are known-wrong.
#
#   quality — `oracle_*` FIRST, `judge_*` second. The judge is a model and it is
#             unreliable in a way you cannot predict from its own output: at n=12
#             on 11-recent-window it scored 8–10 and called all twelve `pass`
#             while a deterministic oracle showed every one of them failing AC4.
#             `grade-oracle.sh` has existed the whole time and the runner never
#             called it, so the scorecard's only quality column was the one the
#             README proves wrong. Both now ship: the oracle for "does AC4 hold",
#             the judge for simplicity/fit, which no assertion can express.
#   speed   — `wall_s` ONLY. `duration_ms` from the envelope counts the top
#             session and not sub-agent time (72s recorded against a true 841s),
#             so it is kept for forensics under its honest name `envelope_ms`
#             and never aggregated as a speed number.
#   cost    — `cost_usd` (trustworthy: the envelope's own total).
#   context — `ctx_*`, from context-metrics.sh, which reads the run's transcript
#             tree off disk. Costs no tokens. The envelope's `usage.input_tokens`
#             sees only the top session and reported 186 for a run that carried
#             14,465,096 input tokens, so the old `in_tokens`/`out_tokens` fields
#             are replaced rather than kept beside the truth.
#
# `outcome` classifies the row in one word, because `ok=false` conflates a
# workflow defect with the workflow WORKING. A `/dev` run that halts to ask a
# human about a real contradiction is the one thing a plain prompt cannot do —
# and it scored exactly like a crash. `outcome=blocked` makes it countable;
# aggregate.sh reports it in its own column instead of burying it in a failure
# tally. It still stays out of the medians (there is no delivered code to grade),
# but "excluded because it succeeded differently" is now distinguishable from
# "excluded because it fell over".

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
# Where the repeat counter STARTS. run-parallel.sh launches one child per repeat
# with `--repeats 1`, so without this every merged row carried `repeat: 1` — three
# rows from three different sandboxes, indistinguishable in the scorecard. That is
# not cosmetic: it is why backfill-context.sh cannot tell those rows apart, and it
# made the sandbox directory names collide too (`<task>-<arm>-1` three times).
RBASE=1
[ "${BENCH_RUN:-0}" = "1" ] && MODE="run"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) MODE="run" ;;
    --dry-run) MODE="dry" ;;
    --repeats) REPEATS="$2"; shift ;;
    --repeat-base) RBASE="$2"; shift ;;
    --arm) ARMSEL="$2"; shift ;;
    --tasks) TASKSEL="$2"; shift ;;
    --out) OUT="$2"; PROG="$(dirname "$2")/progress-$(basename "$2" .jsonl).txt"; shift ;;
    --keep) KEEP=1 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$ARMSEL" in
  workflow) ARMS="workflow" ;;
  baseline) ARMS="baseline" ;;
  design)   ARMS="design" ;;
  *)        ARMS="workflow baseline" ;;
esac

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
  echo "axes per row: quality (oracle+judge) · speed (wall_s) · cost (cost_usd) · context (ctx_*)"
  total=0
  for n in $(task_dirs); do
    # Say up front whether this task can be graded objectively. A task without an
    # oracle can still be run, but its quality column is a model's opinion — and
    # that opinion has been wrong at n=12 on this suite. Knowing which tasks are
    # in which state BEFORE spending the run is the point of printing it here.
    if [ -f "$TASKS/$n/oracle/run.sh" ]; then _q="oracle + judge"; else _q="judge ONLY (opinion — no oracle yet)"; fi
    echo "• task $n  [quality: $_q]"
    echo "    (acceptance: $(head -c 60 "$TASKS/$n/acceptance.txt" 2>/dev/null)…)"
    for a in $ARMS; do
      case "$a" in
        design) echo "    arm=$a × $REPEATS  → sandbox + claude -p + grade-design (deterministic) + context-metrics" ;;
        *)      echo "    arm=$a × $REPEATS  → sandbox + claude -p + grade-oracle + judge-outcome + context-metrics" ;;
      esac
      total=$((total + REPEATS))
    done
  done
  echo
  echo "bench (dry-run): $total live run(s) planned. Re-run with --run (needs the claude CLI)."
  echo "Comparison math is already proven: sh tests/run-bench-tests.sh"
  echo "Context costs nothing extra — it is read off the transcript the CLI writes anyway."
  echo "Backfill context onto an existing scorecard without re-running: sh backfill-context.sh <scorecards.jsonl>"
  exit 0
fi

# ---- live ------------------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  echo "bench: SKIP — no \`claude\` CLI on PATH." >&2; exit 0
fi
command -v jq >/dev/null 2>&1 || { echo "bench: jq required" >&2; exit 2; }

mkdir -p "$RESULTS" "$(dirname "$OUT")"
# Concurrency guard: two runners sharing one scorecard file silently destroy each
# other's rows (observed: a runner whose parent died kept going and overwrote a
# second run's results). Warn loudly; `--out <file>` is the fix.
if [ -f "$OUT" ] && [ -n "$(find "$OUT" -newermt '-90 seconds' 2>/dev/null)" ]; then
  echo "⚠ $OUT was written <90s ago — another bench may be running. Use --out <file> to keep runs separate." >&2
fi
: > "$OUT"
PROG="${PROG:-$RESULTS/progress.txt}"

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
# The watchdog touches the flag at $5 before killing, so the caller can tell
# "we ended this" from "it ended itself" — the two demand opposite fixes, and a
# bare nonzero exit looks identical either way.
#
# BOTH bench artifacts live OUTSIDE the sandbox. They used to be written into it,
# where `git add -A` swept them into the graded diff: on a trivial CSV task the
# 30KB envelope plus __pycache__ made up 94% of what the judge read (1.8KB of
# actual solution) and ate half the 60KB diff cap. On a longer run the envelope
# grows with turn count, pushing the real code out of the cap entirely — the
# judge then grades bench metadata and scores the run 0.
# $1 secs · $2 outfile · $3 sandbox (cwd) · $4 prompt-file · $5 timeout-flag path
run_capture() {
  rm -f "$5"
  ( cd "$3" && claude -p "$(cat "$4")" --output-format json --dangerously-skip-permissions --model "$MODEL" ) >"$2" 2>/dev/null &
  cpid=$!
  ( sleep "$1"; : > "$5"; kill -TERM "$cpid" 2>/dev/null; sleep 3; kill -KILL "$cpid" 2>/dev/null ) &
  wpid=$!
  wait "$cpid" 2>/dev/null; rc=$?
  kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null
  return "$rc"
}

# Which /dev produced this row. Without it, rows collected across commits are not
# comparable and a ratchet silently compares two different workflows — the runs
# taken while the harness itself was being fixed are exactly that hazard. `-dirty`
# marks an uncommitted tree, where the sha alone does not identify what ran.
workflow_sha() {
  _s="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
  [ -n "$_s" ] || { printf ''; return; }
  # Only the workflow surface matters; a dirty bench harness does not change /dev.
  if [ -n "$(git -C "$ROOT" status --porcelain -- .claude WORKFLOW.md CLAUDE.md 2>/dev/null | grep -v '\.claude/tests/' || true)" ]; then
    printf '%s-dirty' "$_s"
  else
    printf '%s' "$_s"
  fi
}

WFSHA="$(workflow_sha)"
echo "progress file: $PROG   (watch live: tail -f $RESULTS/run.log  |  cat $PROG)"
echo "workflow under test: ${WFSHA:-unknown}"
case "$WFSHA" in *-dirty)
  echo "⚠ the workflow tree has uncommitted changes — this row is not reproducible from the sha alone" >&2 ;;
esac
progress "starting — $TOTAL unit(s)"
SANDROOT="$(mktemp -d)"
cleanup() { [ "$KEEP" = "1" ] && echo "sandboxes kept under $SANDROOT" || rm -rf "$SANDROOT"; }
# A signal trap that does not exit SWALLOWS the signal: the handler runs and the
# script resumes at the next statement. This one deleted $SANDROOT and carried on
# — every later repeat then ran against a sandbox root that no longer existed,
# emitting `no_envelope` rows into the scorecard, and `kill`/Ctrl-C could not stop
# it. That is the "runner whose parent process died kept going and overwrote a
# later run's results" incident in README.md; the cause was here, not upstream.
# EXIT alone cleans up; INT/TERM must clean up AND leave.
on_signal() { cleanup; trap - EXIT; exit 130; }
trap cleanup EXIT
trap on_signal INT TERM

git_base() { ( cd "$1" && git init -q && git add -A && git -c user.email=b@bench -c user.name=bench commit -qm base >/dev/null 2>&1 ); }

# One word for what happened, derived from fail_reason so the classification
# lives in exactly one place. The distinction that matters is `blocked`: a run
# that halted to ask a human about a real contradiction did the job a plain
# prompt cannot, and reporting it as a failure is how the harness ends up unable
# to observe its own product succeeding (README > "blocked_at_* is the pipeline
# succeeding, and the scorecard calls it a failure").
classify_outcome() {  # $1 ok, $2 fail_reason
  case "$2" in
    "")                   [ "$1" = "true" ] && printf 'ok' || printf 'fail' ;;
    blocked_at_*)         printf 'blocked' ;;
    incomplete_at_*)      printf 'incomplete' ;;
    design_incomplete_at_*) printf 'design_incomplete' ;;
    exit_*)               printf 'crash' ;;
    timeout|no_envelope|api_error) printf '%s' "$2" ;;
    *)                    printf 'fail' ;;
  esac
}

setup_workflow() {  # $1 sandbox, $2 task
  s="$1"; t="$2"; mkdir -p "$s/.workflow"
  cp -R "$ROOT/.claude" "$s/.claude"
  # NEVER ship the bench into the sandbox it is grading. `.claude/tests/bench`
  # holds `tasks/<t>/acceptance.txt` — the graded criteria WITH the trap spelled
  # out — plus every baseline and past result. Copying it handed the workflow arm
  # an answer key the baseline arm (bare repo, no `.claude/`) never gets, which is
  # exactly the asymmetry README > "A task is only useful if the baseline can fail
  # it" exists to prevent. Observed live: a run ran `cat …/tasks/11-recent-window/
  # design.txt; cat …/baseline.txt` and Read `acceptance.txt` from its own tree.
  # It also made every `grep -r .` in the sandbox wade through results/ and
  # sandboxes/, and swept them into the graded `git add -A` diff.
  rm -rf "$s/.claude/tests"
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

# emit — write one scorecard row.
#
# The positional list stops at the fields that were already here; the three
# blocks added for the four-axis scorecard (context, oracle, outcome) arrive as
# globals instead. Nineteen positionals was already at the edge of readable, and
# `${27}` in a shell call site is where a metric silently lands in the wrong
# column. Callers set CTXJSON / ORACLEJSON / OUTCOME before calling.
CTXJSON="null"; ORACLEJSON="null"; STATEJSON="null"; OUTCOME=""; SANDBOX=""; STARTED=""
emit() {  # all values already JSON-literal-safe strings ("null" when absent)
  jq -cn \
    --arg sandbox "${SANDBOX:-}" --arg started "${STARTED:-}" \
    --arg task "$1" --arg arm "$2" --argjson repeat "$3" --argjson ok "$4" \
    --argjson cost "$5" --argjson intok "$6" --argjson outtok "$7" --argjson turns "$8" --argjson dur "$9" \
    --argjson spawn "${10}" --argjson cyt "${11}" --argjson cyr "${12}" --argjson skip "${13}" \
    --argjson jscore "${14}" --arg jverd "${15}" --argjson wall "${16}" --arg freason "${17}" \
    --arg wfsha "${18}" --argjson spawnobs "${19}" \
    --argjson ctx "${CTXJSON:-null}" --argjson oracle "${ORACLEJSON:-null}" --argjson state "${STATEJSON:-null}" --arg outcome "${OUTCOME:-}" \
    '{task:$task, arm:$arm, repeat:$repeat, ok:$ok,
      # One word for what happened. `ok` alone cannot say whether a row is
      # missing because the run crashed or because it stopped for a human.
      outcome:(if $outcome != "" then $outcome elif $ok then "ok" else "fail" end),
      fail_reason:(if $freason == "" then null else $freason end),
      workflow_sha:(if $wfsha == "" then null else $wfsha end),
      # Where the run happened and when. Recorded because the CONTEXT axis is
      # read from a transcript keyed by the sandbox path, and a row that cannot
      # name its own sandbox cannot be re-measured later: every pre-existing
      # baseline in this repo has that problem, and backfill-context.sh has to
      # guess from directory names because of it. One string ends that.
      sandbox:(if $sandbox == "" then null else $sandbox end),
      started_at:(if $started == "" then null else $started end),
      cost_usd:$cost, turns:$turns, wall_s:$wall,
      # SPEED IS wall_s. The envelope clock is kept for forensics under a name
      # that cannot be mistaken for the run duration: it timed one /dev run at
      # 72s that really took 841s, because it does not see sub-agent time.
      envelope_ms:$dur,
      # The envelope token fields see the top session only — 186 input tokens on
      # a run that carried 14.4M. They are recorded under `envelope_*` names so a
      # reader cannot mistake them for the token truth in ctx_*, and nothing
      # downstream medians them.
      envelope_in_tokens:$intok, envelope_out_tokens:$outtok,
      spawn_count:$spawn, spawn_observed:$spawnobs, cycles_test:$cyt, cycles_review:$cyr, skipped:$skip,
      judge_score:$jscore, judge_verdict:$jverd}
     + (if $state == null then
          {work_profile:null,risk:null,ambiguity:null,volume:null,coupling:null,evidence:null,
           main_turn_target:null,main_turn_ceiling:null,main_turn_observed:null,budget_exceeded:null,
           agent_active_ms:null,human_wait_ms:null,worker_runtime_ms:null,worker_wait_ms:null,reconcile_ms:null}
        else
          {work_profile:($state.work_profile // null),risk:($state.risk // null),
           ambiguity:($state.ambiguity // null),volume:($state.volume // null),
           coupling:($state.coupling // null),evidence:($state.evidence // null),
           main_turn_target:($state.orchestrator_budget.target_turns // null),
           main_turn_ceiling:($state.orchestrator_budget.hard_ceiling // null),
           main_turn_observed:($state.orchestrator_budget.turns_observed // null),
           budget_exceeded:($state.orchestrator_budget.exceeded // null),
           agent_active_ms:($state.timing.agent_active_ms // null),
           human_wait_ms:($state.timing.human_wait_ms // null),
           worker_runtime_ms:($state.timing.worker_runtime_ms // null),
           worker_wait_ms:($state.timing.worker_wait_ms // null),
           reconcile_ms:($state.timing.reconcile_ms // null)}
        end)
     # CONTEXT — the fourth axis. Null-filled when no transcript was found, so a
     # missing measurement reads as absent and never as zero context.
     + (if $ctx == null or ($ctx.found | not) then
          {ctx_boot:null, ctx_peak:null, ctx_mean:null, ctx_in_total:null,
           ctx_out_total:null, ctx_cache_hit:null, ctx_reqs:null,
           ctx_agents:null, ctx_agent_in_total:null}
        else
          {ctx_boot:$ctx.ctx_boot, ctx_peak:$ctx.ctx_peak, ctx_mean:$ctx.ctx_mean,
           ctx_in_total:$ctx.ctx_in_total, ctx_out_total:$ctx.ctx_out_total,
           ctx_cache_hit:$ctx.ctx_cache_hit, ctx_reqs:$ctx.ctx_reqs,
           ctx_agents:$ctx.ctx_agents, ctx_agent_in_total:$ctx.ctx_agent_in_total}
        end)
     # QUALITY, objective half. Null when the task has no oracle — most do not
     # yet, and an absent oracle must not read as a failing one.
     + (if $oracle == null then
          {oracle_score:null, oracle_max:null, oracle_verdict:null, oracle_fails:null}
        else
          {oracle_score:$oracle.score, oracle_max:$oracle.max,
           oracle_verdict:($oracle.verdict // null),
           oracle_fails:(($oracle.results // {}) | to_entries
                         | map(select(.value != "pass") | .key))}
        end)' >> "$OUT"
}

runs=0
for n in $(task_dirs); do
  acc="$TASKS/$n/acceptance.txt"
  for a in $ARMS; do
    prompt_file="$TASKS/$n/$a.txt"
    [ -f "$prompt_file" ] || { echo "   (no $a.txt for $n — skip)"; continue; }
    # Repeat indices run [RBASE, RBASE+REPEATS). Serially RBASE is 1 and this is
    # the old behaviour; run-parallel.sh passes a distinct base per child so the
    # merged rows carry distinct repeat numbers and distinct sandbox names.
    r="$RBASE"; rlast=$((RBASE + REPEATS - 1))
    while [ "$r" -le "$rlast" ]; do
      progress "$n · arm=$a · run $r/$rlast — launching claude (≤${TIMEOUT_S}s)"
      sb="$SANDROOT/$n-$a-$r"
      case "$a" in workflow|design) setup_workflow "$sb" "$n" ;; *) setup_baseline "$sb" "$n" ;; esac
      base_sha="$(git -C "$sb" rev-parse HEAD 2>/dev/null || echo HEAD)"   # judge diffs against this (survives a /dev commit)

      # Real wall-clock — the envelope's duration_ms only counts the top session,
      # not sub-agent spawns, so it wildly under-reports a /dev run (65s vs a true
      # 13min). Measure it ourselves; this is the honest time axis.
      # Siblings of the sandbox, never inside it — anything under $sb lands in the
      # graded diff via `git add -A` and displaces the solution the judge is meant
      # to read. --keep preserves $SANDROOT, so these stay inspectable either way.
      envf="$SANDROOT/$n-$a-$r.envelope.json"
      tmof="$SANDROOT/$n-$a-$r.timeout"
      # Record the RESOLVED path: on macOS mktemp hands back /var/... while the
      # CLI records /private/var/... in the transcript slug, so the unresolved
      # form does not round-trip.
      SANDBOX="$(cd "$sb" 2>/dev/null && pwd -P || printf '%s' "$sb")"
      STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf '')"
      t0="$(date +%s 2>/dev/null || echo 0)"
      rc=0
      run_capture "$TIMEOUT_S" "$envf" "$sb" "$prompt_file" "$tmof" || rc=$?
      [ "$rc" = "0" ] || echo "   ! run exited nonzero (watchdog kill or error)"
      wall_s=$(( $(date +%s 2>/dev/null || echo 0) - t0 ))
      envj="$(cat "$envf" 2>/dev/null || true)"
      ok=false; cost=null; intok=null; outtok=null; turns=null; dur=null; freason=""
      if [ -n "$envj" ] && printf '%s' "$envj" | jq -e . >/dev/null 2>&1; then
        # `--output-format json` may be a single result object OR a stream array
        # (CLI-version dependent) — normalize to the result object either way.
        robj="$(printf '%s' "$envj" | jq -c 'if type=="array" then ((map(select(.type=="result")) | last) // .[-1] // {}) else . end' 2>/dev/null || printf '{}')"
        [ -n "$robj" ] || robj='{}'
        # _get: read a field, always yield a JSON-literal ("null" on miss/error)
        # so the later --argjson never sees an empty string.
        _get() { _v="$(printf '%s' "$robj" | jq -r "($1) // \"null\"" 2>/dev/null || true)"; [ -n "$_v" ] && printf '%s' "$_v" || printf 'null'; }
        if printf '%s' "$robj" | jq -e '.is_error == true' >/dev/null 2>&1; then ok=false; freason="api_error"; else ok=true; fi
        cost="$(_get '.total_cost_usd // .cost_usd')"
        intok="$(_get '.usage.input_tokens')"
        outtok="$(_get '.usage.output_tokens')"
        turns="$(_get '.num_turns')"
        dur="$(_get '.duration_ms')"
      else
        echo "   ! claude run produced no JSON envelope (timeout/stall)"
        ok=false; freason="no_envelope"
      fi
      # The watchdog's verdict outranks the envelope: when WE ended the run, a
      # missing or errored envelope is our doing, and nothing downstream should
      # read the row as evidence about the workflow.
      if [ -f "$tmof" ]; then
        ok=false; freason="timeout"
        echo "   ! watchdog fired at ${TIMEOUT_S}s — row excluded from medians (raise BENCH_TIMEOUT)"
      elif [ "$ok" = "true" ] && [ "$rc" != "0" ]; then
        ok=false; freason="exit_$rc"
      fi

      # ---- CONTEXT (free) ----------------------------------------------------
      # Read off the transcript the CLI already wrote; no extra run, no tokens.
      # Done here rather than after grading because it describes the run itself
      # and must be recorded even for a row that failed — a timeout that got to
      # 190k of context is a different problem from one that stalled at boot.
      # A failure to find the transcript is recorded as found=false and the
      # ctx_* fields go null; it must never abort a run or read as zero context.
      CTXJSON="$(sh "$HERE/context-metrics.sh" "$sb" 2>/dev/null || true)"
      printf '%s' "$CTXJSON" | jq -e . >/dev/null 2>&1 || CTXJSON="null"
      if [ "$CTXJSON" != "null" ] && printf '%s' "$CTXJSON" | jq -e '.found' >/dev/null 2>&1; then
        echo "   context: boot=$(printf '%s' "$CTXJSON" | jq -r '(.ctx_boot/1000*10|round)/10')k peak=$(printf '%s' "$CTXJSON" | jq -r '(.ctx_peak/1000*10|round)/10')k in_total=$(printf '%s' "$CTXJSON" | jq -r '(.ctx_in_total/1000000*100|round)/100')M reqs=$(printf '%s' "$CTXJSON" | jq -r '.ctx_reqs') agents=$(printf '%s' "$CTXJSON" | jq -r '.ctx_agents')"
      else
        echo "   context: not measured (no transcript for this sandbox)"
      fi

      spawn=null; spawnobs=null; cyt=null; cyr=null; skip=null; STATEJSON="null"
      if [ "$a" = "workflow" ] || [ "$a" = "design" ]; then
        rd="$(find "$sb/.workflow" -mindepth 1 -maxdepth 1 -type d ! -name _templates 2>/dev/null | head -n1)"
        if [ -n "$rd" ] && [ -f "$rd/state.json" ]; then
          STATEJSON="$(jq -c . "$rd/state.json" 2>/dev/null || printf 'null')"
          # A /dev run that stops early exits CLEANLY — the CLI returns a healthy
          # envelope, so ok stays true and the judge just finds no code. Observed:
          # a run halted at the gate on a benign "Docs: light" deviation, burned
          # $2.80 over 640s, delivered zero code, and scored as a successful run.
          # `done_at` is the run's own completion stamp: absent means it never
          # reached Close, whatever the exit code said.
          # `--plan-only` halts at the gate on purpose and leaves done_at unset
          # (the run is paused, not finished — orchestrator.md > Plan-only), so the
          # design arm is graded on reaching the gate, not on completing a run.
          if [ "$a" = "design" ]; then
            if [ "$(jq -r '.next_step // "null"' "$rd/state.json")" != "implement" ]; then
              ok=false
              [ -n "$freason" ] || freason="design_incomplete_at_$(jq -r '.step // "unknown"' "$rd/state.json")"
              echo "   ! design arm never reached the gate; excluded from medians"
            fi
          elif [ "$(jq -r '.done_at // "null"' "$rd/state.json")" = "null" ]; then
            _at="$(jq -r '.next_step // .step // "unknown"' "$rd/state.json")"
            ok=false
            # `incomplete_at_*` conflates two opposite outcomes, and the difference
            # decides whether the row is a workflow defect or the workflow working.
            # Seen live on the M lane: of five halted runs, one had returned a
            # legitimate BLOCKER (the spec's stated rounding rule contradicted its
            # own acceptance criteria — the plain prompt silently guessed instead),
            # while the others simply ran out mid-flight after passing 28/31 tests.
            # Both landed in the scorecard as the same `incomplete_at_review`.
            # A run that stopped to ask a human did its job; a run that fell over
            # did not. `notes` is where the orchestrator records a stop, so read it.
            _notes="$(jq -r '.notes // ""' "$rd/state.json")"
            if printf '%s' "$_notes" | grep -qiE '(^|[^a-z])(blocked|blocker|non_interactive_blocker)'; then
              [ -n "$freason" ] || freason="blocked_at_$_at"
              echo "   ! run BLOCKED before '$_at' — stopped for a human, not a failure; excluded from medians"
              echo "     reason: $(printf '%s' "$_notes" | tr ';' '\n' | grep -iE 'block' | head -1 | cut -c1-160)"
            else
              [ -n "$freason" ] || freason="incomplete_at_$_at"
              echo "   ! run never completed — stopped before '$_at' (no done_at, no BLOCKER recorded); excluded from medians"
            fi
          fi
          spawn="$(jq -r '.spawn_count // "null"' "$rd/state.json")"
          # Observed spawns, counted by the PreToolUse guard hook rather than
          # self-reported — the two disagree when the orchestrator forgets to bump
          # (seen: spawn_count=0 on a run whose notes say "combined lead spawn").
          if [ -f "$rd/.spawn_log" ]; then spawnobs="$(wc -l < "$rd/.spawn_log" | tr -d ' ')"; fi
          cyt="$(jq -r '.cycles.test // "null"' "$rd/state.json")"
          cyr="$(jq -r '.cycles.review // "null"' "$rd/state.json")"
          skip="$(jq -r '(.skipped_steps // []) | length' "$rd/state.json")"
          [ -f "$DEVMETRICS" ] && sh "$DEVMETRICS" "$rd" 2>/dev/null | sed 's/^/     /' || true
        fi
      fi

      # The judge still runs on a failed row: the score is forensics (how far did
      # it get before dying), not a quality measurement — aggregate.sh drops it.
      jscore=null; jverd=skip
      if [ "$a" = "design" ]; then
        # Deterministic grade — no model, no tokens, no variance (grade-design.sh).
        # It measures whether the design set is complete and self-consistent, NOT
        # whether it captured unstated requirements; only delivered code shows that.
        dout="$(sh "$HERE/grade-design.sh" "$sb" 2>/dev/null || true)"
        if [ -n "$dout" ] && printf '%s' "$dout" | jq -e . >/dev/null 2>&1; then
          jscore="$(printf '%s' "$dout" | jq -r '.score // "null"')"
          jverd="$(printf '%s' "$dout"  | jq -r '.verdict // "skip"')"
          echo "   grade-design: $dout"
        else
          echo "   grade-design: unjudgeable (no run dir)"
        fi
        # The design arm delivers no code, so there is nothing for an oracle to
        # assert against — grade-design.sh is already the deterministic grader
        # for this arm. Leaving oracle_* null is the honest record.
        ORACLEJSON="null"; OUTCOME="$(classify_outcome "$ok" "$freason")"
        emit "$n" "$a" "$r" "$ok" "$cost" "$intok" "$outtok" "$turns" "$dur" "$spawn" "$cyt" "$cyr" "$skip" "$jscore" "$jverd" "${wall_s:-null}" "$freason" "$WFSHA" "$spawnobs"
        runs=$((runs + 1)); DONE=$((DONE + 1)); r=$((r + 1))
        progress "$n · arm=$a done — ok=$ok${freason:+ ($freason)} cost=\$$cost design=$jscore/$jverd"
        continue
      fi
      # ---- QUALITY, objective half (free, deterministic) ---------------------
      # Runs FIRST because it is the one that can be checked. The judge is a
      # model asked for an opinion; the oracle asserts each criterion directly.
      # On 11-recent-window the judge scored twelve diffs 8-10 and called all
      # twelve `pass` while every one of them objectively failed AC4 — so a
      # quality claim built on judge_score alone has been wrong, at n=12, on
      # this very suite. grade-oracle.sh has existed since then and no runner
      # ever called it; that is the single largest hole in the quality axis.
      # exit 3 = this task has no oracle yet (most do not) — not a failure.
      ORACLEJSON="null"
      oout="$(sh "$HERE/grade-oracle.sh" "$sb" "$n" 2>/dev/null || true)"
      if [ -n "$oout" ] && printf '%s' "$oout" | jq -e '.score' >/dev/null 2>&1; then
        ORACLEJSON="$oout"
        echo "   grade-oracle: $(printf '%s' "$oout" | jq -r '"\(.score)/\(.max) \(.verdict // "")"')$(printf '%s' "$oout" | jq -r '((.results // {}) | to_entries | map(select(.value != "pass") | .key)) | if length == 0 then "" else "  failing: " + join(",") end')"
      else
        echo "   grade-oracle: no oracle for $n (quality rests on the judge alone — read it as an opinion)"
      fi

      jout="$(sh "$HERE/judge-outcome.sh" "$sb" "$acc" --base "$base_sha" --model "$MODEL" 2>/dev/null || true)"
      if [ -n "$jout" ] && printf '%s' "$jout" | jq -e . >/dev/null 2>&1; then
        jscore="$(printf '%s' "$jout" | jq -r '.score // "null"')"
        jverd="$(printf '%s' "$jout"  | jq -r '.verdict // "skip"')"
        echo "   judge-outcome: score=$jscore verdict=$jverd"
      else
        echo "   judge-outcome: skipped"
      fi
      # When both graded and they disagree, say so at the point of measurement.
      # The disagreement is the finding — it is how the AC4 blindness was caught
      # — and it is invisible once the two numbers are separate columns in a table.
      if [ "$ORACLEJSON" != "null" ] && [ "$jverd" != "skip" ]; then
        overd="$(printf '%s' "$ORACLEJSON" | jq -r '.verdict // ""')"
        if [ -n "$overd" ] && [ "$overd" != "$jverd" ]; then
          echo "   ⚠ graders DISAGREE — oracle=$overd judge=$jverd. The oracle is the one that can be checked."
        fi
      fi

      OUTCOME="$(classify_outcome "$ok" "$freason")"
      emit "$n" "$a" "$r" "$ok" "$cost" "$intok" "$outtok" "$turns" "$dur" "$spawn" "$cyt" "$cyr" "$skip" "$jscore" "$jverd" "${wall_s:-null}" "$freason" "$WFSHA" "$spawnobs"
      runs=$((runs + 1)); DONE=$((DONE + 1)); r=$((r + 1))
      progress "$n · arm=$a done — ok=$ok${freason:+ ($freason)} cost=\$$cost judge=$jscore/$jverd"
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
