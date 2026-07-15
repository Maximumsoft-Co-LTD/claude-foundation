#!/usr/bin/env bash
# PreToolUse guard for the /dev workflow.
#
# Catches the following known failure modes when the orchestrator (main agent) delegates work:
#
#   1. subagent_type="orchestrator" — there is no orchestrator sub-agent;
#      the main agent IS the orchestrator. Spawn would fail with
#      "Agent type 'orchestrator' not found", but better to fail loud here
#      with the right pointer to the correct worker name.
#
#   2. subagent_type="general-purpose" while the description prefix targets
#      a /dev worker (pm, lead, engineer, qa, retro). This is the model
#      "knowing but not complying" — it labels the description with the
#      intended worker name but routes to the catch-all agent anyway.
#      Block and tell it to retry with the correct subagent_type.
#
#   3. state.json not updated between worker spawns. The companion
#      PostToolUse hook dev-state-mark.sh touches .last_worker_return
#      inside the active run dir when a worker returns. If the marker
#      is newer than state.json on the next worker spawn, the orchestrator
#      skipped the bookkeeping step prescribed by orchestrator.md > State
#      discipline. Block until state.json catches up — resume depends on it.
#      The active run is taken from $CLAUDE_DEV_RUN_ID when set, else the
#      single active run under .workflow/. With two or more runs active at
#      once (concurrent /dev runs, or a worktree sharing the tree) "newest
#      state.json" can name a DIFFERENT run than this spawn, so the check
#      fails OPEN rather than block the wrong run with a stale id.
#
#   4. model override that contradicts a named worker's `model:` frontmatter.
#      A `model` param outranks the agent-definition model, so the orchestrator
#      (or a stray override) can silently run a cheaper-pinned worker on the
#      opus main-session tier. Block when a non-exempt worker (pm, engineer,
#      qa, retro, uxui, or any team-* fanout worker) is spawned with model !=
#      its pinned frontmatter value — each keeps the tier its own agent file
#      sets (the haiku analyzers stay haiku). `lead` is exempt — the playbook
#      tunes it sonnet<->opus per phase. Reads the pinned value from disk, so
#      flipping a worker's own `model:` (e.g. pm -> opus) is honoured with no
#      hook change.
#
#   5. subagent_type="fork" during an active /dev run. A fork inherits the main
#      agent's model AND context, bypassing the worker frontmatter entirely, so
#      an opus main session drags opus onto every forked worker. /dev spawns
#      workers by name, so fork is never the sanctioned path mid-run. Outside a
#      /dev run fork is a normal harness feature and passes through.
#
#   6. subagent_type in {general-purpose, Explore} on any spawn without
#      model=sonnet — in or out of a /dev run. Neither built-in has a `model:`
#      frontmatter, so an absent or non-sonnet model inherits the main-session
#      tier — an opus main session then runs the search/explore helper on opus.
#      These generic built-ins only ever need sonnet, so require it explicitly.
#      Named team-* keep their own tier via Case 4; this sonnet floor only
#      governs the generic built-ins. A job that genuinely needs a higher tier
#      should spawn a named worker instead.
#
# This hook sits on the critical path of EVERY Agent spawn, so it does the least
# work possible: a single jq parse pulls tool_name + subagent_type (both
# newline-free tokens) in one process; the spawn-heavy `description` field is
# only parsed in Case 2, where it's actually needed. The Case 3 freshness check
# uses bash globbing + `-nt` (no subprocesses) plus one jq to read `size` for
# the XS/S enforcement skip. Case 4 adds one jq for `model` (then a sed only when
# a model param is present); Cases 5 & 6 share one `.workflow` glob that runs
# only for a fork or general-purpose spawn (Case 6 adds one more jq for `model`).
# Net: a non-/dev Agent spawn pays one jq; a plain /dev worker spawn pays two
# (fields + size); a model-override, fork, or general-purpose spawn pays one
# extra cheap read.

set -euo pipefail

input="$(cat)"

# One jq parse for the two fields every branch needs. `|| true` keeps the hook
# fail-open: a malformed payload yields empty fields and the guard waves it through.
IFS=$'\t' read -r tool_name subagent_type < <(
  printf '%s' "$input" | jq -r '[(.tool_name // ""), (.tool_input.subagent_type // "")] | @tsv'
) || true

[[ "$tool_name" != "Agent" ]] && exit 0

# Case 1: orchestrator is never a valid sub-agent
if [[ "$subagent_type" == "orchestrator" ]]; then
  jq -n '{
    decision: "block",
    reason: "BLOCKED by /dev guard: there is no `orchestrator` sub-agent. You — the main agent — ARE the orchestrator. Worker sub-agents you can spawn are: pm, lead, engineer, qa, retro (defined in .claude/agents/). Pick the right one and retry."
  }'
  exit 0
fi

# Case 2: general-purpose fallback with worker-name prefix in description.
# The description (which can contain newlines) is parsed only here, off the hot path.
if [[ "$subagent_type" == "general-purpose" ]]; then
  description="$(printf '%s' "$input" | jq -r '.tool_input.description // ""')"
  # case-insensitive match for the worker prefix
  desc_lc="$(printf '%s' "$description" | tr '[:upper:]' '[:lower:]')"
  for worker in pm lead engineer qa retro uxui; do
    # match "<worker>:", "<worker> ", "<worker>(" at the start of the description
    if [[ "$desc_lc" =~ ^${worker}[[:space:]:\(] ]] || [[ "$desc_lc" == "$worker" ]]; then
      jq -n --arg w "$worker" '{
        decision: "block",
        reason: ("BLOCKED by /dev guard: you set subagent_type=\"general-purpose\" but the description starts with \"\($w)\" — that signals you intended to spawn the `\($w)` worker agent. These worker agents live in .claude/agents/ and must be called by name. Retry with subagent_type=\"\($w)\" instead. (Worker agents: pm, lead, engineer, qa, retro; team-mode: uxui.)")
      }'
      exit 0
    fi
  done
fi

# Case 3: state.json must be updated between /dev worker spawns
case "$subagent_type" in
  pm|lead|engineer|qa|retro)
    PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
    WF_DIR="$PROJECT_DIR/.workflow"
    if [[ -d "$WF_DIR" ]]; then
      # Identify the run this freshness check applies to.
      #   a. $CLAUDE_DEV_RUN_ID — the orchestrator's explicit, concurrency-safe
      #      signal (also the right knob when /dev runs inside a git worktree).
      #   b. otherwise the single active (non-_templates) run. With 0 runs there
      #      is nothing to enforce; with 2+ runs the "newest state.json" heuristic
      #      can name a DIFFERENT run than this spawn, so fail OPEN — never
      #      false-block one run because a concurrent sibling wrote its state.
      active_state=""
      if [[ -n "${CLAUDE_DEV_RUN_ID:-}" ]] && [[ -f "$WF_DIR/$CLAUDE_DEV_RUN_ID/state.json" ]]; then
        active_state="$WF_DIR/$CLAUDE_DEV_RUN_ID/state.json"
      else
        active_count=0
        for f in "$WF_DIR"/*/state.json; do
          [[ -f "$f" ]] || continue
          # _templates holds the blueprint state.json, not a run — never treat it as a run
          [[ "$(basename "$(dirname "$f")")" == "_templates" ]] && continue
          active_count=$((active_count + 1))
          active_state="$f"
        done
        [[ "$active_count" -eq 1 ]] || active_state=""
      fi
      if [[ -n "$active_state" ]]; then
        # Size-aware enforcement. XS/S runs spawn few workers and are cheap to
        # re-run from scratch, so the inter-spawn freshness block costs more
        # (a BLOCKED retry loop) than the resume granularity it buys. The
        # orchestrator still WRITES state on XS/S (orchestrator.md > State
        # discipline) — we just drop the hard block. M/L keep it, where a
        # mid-run crash is expensive to redo. Legacy/malformed state with no
        # `size` field falls through to enforcement (safe default).
        run_size="$(jq -r '.size // ""' "$active_state" 2>/dev/null || printf '')"
        case "$run_size" in
          XS|S) exit 0 ;;
        esac
        run_dir="$(dirname "$active_state")"
        run_id="$(basename "$run_dir")"
        marker="$run_dir/.last_worker_return"
        # Block only if both files exist AND marker is newer. If marker is
        # missing, this is the first worker spawn of the run — let it through.
        if [[ -f "$marker" ]] && [[ "$marker" -nt "$active_state" ]]; then
          state_rel=".workflow/$run_id/state.json"
          reason="BLOCKED by /dev guard: $state_rel was not updated after the last worker returned. orchestrator.md > State discipline requires writing state.json (phase, step, next_step, cycles, last_updated, last_agent) after EVERY step, before spawning the next worker — otherwise /dev --resume $run_id is broken. Update $state_rel via Write/Edit, then retry the spawn."
          jq -n --arg reason "$reason" '{decision: "block", reason: $reason}'
          exit 0
        fi
      fi
    fi
    ;;
esac

# Case 4: a model override on a named /dev worker must match that worker's
# pinned `model:` frontmatter, so an opus main session can't silently run a
# cheaper-pinned worker on opus (a `model` param outranks the frontmatter).
# Covers the core workers plus every team-* fanout worker (the `team-*` glob) —
# each runs at the tier its own agent file sets (e.g. the haiku analyzers stay
# haiku, not the opus main tier). `lead` is the sanctioned exception — the
# playbook tunes it sonnet<->opus per phase; to give another worker that
# freedom, drop it from the list below. Frontmatter-driven: flipping a worker's
# own `model:` (e.g. pm -> opus) needs no change here — the pinned value is
# re-read from disk each spawn, and `$subagent_type.md` already resolves team-*.
case "$subagent_type" in
  pm|engineer|qa|retro|uxui|team-*)
    req_model="$(printf '%s' "$input" | jq -r '.tool_input.model // ""')"
    if [[ -n "$req_model" ]]; then
      def="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/agents/$subagent_type.md"
      # `|| true`: under `set -euo pipefail` a missing/unreadable $def made this
      # assignment kill the whole hook (rc=1, fail-open-by-crash) before any
      # branch below could run.
      pinned="$(sed -n 's/^model:[[:space:]]*//p' "$def" 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
      if [[ -z "$pinned" ]]; then
        # Fail CLOSED: an override is being requested but the pin can't be read
        # (file missing or frontmatter reformatted). Allowing here would let the
        # override run unchecked at whatever tier it names — the exact leak this
        # case exists to stop. No-override spawns never reach this branch.
        reason="BLOCKED by /dev guard: spawning \`$subagent_type\` with model=\"$req_model\" but its pinned model: frontmatter could not be read from $def (file missing or frontmatter reformatted). Cannot verify the override matches the pin, so it is refused — drop the model param to spawn at the agent file's own tier, or fix the frontmatter (a top-level 'model: <tier>' line)."
        jq -n --arg r "$reason" '{decision:"block", reason:$r}'
        exit 0
      fi
      if [[ "$req_model" != "$pinned" ]]; then
        reason="BLOCKED by /dev guard: spawning \`$subagent_type\` with model=\"$req_model\" but its agent definition pins model: $pinned. A model override here silently runs the wrong tier (e.g. a higher-tier main session leaking onto a sonnet-pinned worker). Drop the model param so the frontmatter governs — only lead may vary sonnet/opus per phase. (To let $subagent_type vary too, remove it from the Case 4 list in dev-agent-guard.sh.)"
        jq -n --arg r "$reason" '{decision:"block", reason:$r}'
        exit 0
      fi
    fi
    ;;
esac

# fork and the generic built-ins (general-purpose, Explore) all inherit the
# main agent's tier (opus), bypassing the worker `model:` frontmatter. They
# diverge on scope: fork is only a problem inside a /dev run (Case 5), so
# compute "is a run active?" once here; the generic built-ins are pinned to
# sonnet on every spawn (Case 6) and ignore the run state.
case "$subagent_type" in
  fork|general-purpose|Explore)
    PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
    WF_DIR="$PROJECT_DIR/.workflow"
    active=""
    if [[ -n "${CLAUDE_DEV_RUN_ID:-}" && -f "$WF_DIR/$CLAUDE_DEV_RUN_ID/state.json" ]]; then
      active="1"
    elif [[ -d "$WF_DIR" ]]; then
      for f in "$WF_DIR"/*/state.json; do
        [[ -f "$f" ]] || continue
        [[ "$(basename "$(dirname "$f")")" == "_templates" ]] && continue
        active="1"; break
      done
    fi

    # Case 5: fork inside an active /dev run. A fork inherits the main agent's
    # model AND context, ignoring the worker's `model:` frontmatter entirely, so
    # an opus main session drags opus onto every forked worker. /dev always
    # spawns workers by name; block fork while a run is active.
    if [[ -n "$active" && "$subagent_type" == "fork" ]]; then
      reason="BLOCKED by /dev guard: subagent_type=\"fork\" inside an active /dev run. A fork inherits the main agent's model and context and ignores the worker's agent-definition model:, so an opus main session silently runs a sonnet-pinned worker on opus. Spawn the worker by name instead (pm, lead, engineer, qa, retro; team-mode: uxui)."
      jq -n --arg r "$reason" '{decision:"block", reason:$r}'
      exit 0
    fi

    # Case 6: the generic search/explore built-ins (general-purpose, Explore) must
    # set model=sonnet on every spawn — in or out of a /dev run. Neither has a
    # `model:` frontmatter, so an absent or non-sonnet model inherits the main-
    # session tier — an opus main session then runs the search/explore helper on
    # opus. They only ever need sonnet, so require it explicitly and block anything
    # else. (Named team-* keep their own tier via Case 4; a job that genuinely needs
    # a higher tier should spawn a named worker, not a generic built-in.)
    if [[ "$subagent_type" == "general-purpose" || "$subagent_type" == "Explore" ]]; then
      gp_model="$(printf '%s' "$input" | jq -r '.tool_input.model // ""')"
      if [[ "$gp_model" != "sonnet" ]]; then
        reason="BLOCKED by agent guard: subagent_type=\"$subagent_type\" must set model=\"sonnet\" (got \"${gp_model:-<none>}\"). Without it the spawn inherits the main agent's tier, so a higher-tier main session (opus, or above) silently runs a search / explore / inline-fallback helper at that tier. Pass model=\"sonnet\"; if the job genuinely needs a higher tier, spawn a named worker instead."
        jq -n --arg r "$reason" '{decision:"block", reason:$r}'
        exit 0
      fi
    fi
    ;;
esac

exit 0
