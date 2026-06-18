#!/usr/bin/env bash
# PostToolUse marker for the /dev workflow.
#
# When a /dev worker sub-agent (pm | lead | engineer | qa | retro) returns
# from a FOREGROUND spawn:
#   1. Touch a marker file in the most-recently-modified .workflow/<id>/ dir.
#      The companion PreToolUse check in dev-agent-guard.sh refuses to spawn
#      the next worker until state.json has been updated past that marker.
#   2. Emit an additionalContext reminder back to the orchestrator (main
#      agent) so it doesn't forget the state.json write between worker
#      returns. The reminder is what closes the loop on
#      orchestrator.md > State discipline — without it the rule is prose
#      only and gets forgotten in the moment.

set -euo pipefail

# jq is the only hard dependency. Fail open if it's missing — better to lose
# the marker than to break the user's Agent call with a non-/dev failure.
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
[[ "$tool_name" == "Agent" ]] || exit 0

subagent_type="$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // ""')"

# Only mark for /dev worker returns. Other Agent spawns are unrelated and
# their post-hooks shouldn't poison the next /dev worker's pre-check.
case "$subagent_type" in
  pm|lead|engineer|qa|retro) ;;
  *) exit 0 ;;
esac

# A background spawn's tool result is only the launch acknowledgment — the
# worker has NOT returned yet (its completion arrives later as a task
# notification, which fires no PostToolUse). Touching the marker here would
# block every later spawn in a one-message background fanout batch behind a
# state.json bump that has nothing to record. The marker means "a worker
# returned", not "a worker launched" — skip.
run_in_background="$(printf '%s' "$input" | jq -r '.tool_input.run_in_background // false')"
[[ "$run_in_background" == "true" ]] && exit 0

# Team-mode Phase-1 slice spawns (/dev-plan -> lead, /test-plan -> qa) write their
# OWN shard file (state.<slice>.json), NOT the canonical state.json, so they must
# NOT touch the shared .last_worker_return marker. If they did, the next team-mode
# command's worker spawn (a sibling slice, possibly a concurrent session) would see
# a marker newer than the unchanged state.json and be false-blocked by
# dev-agent-guard.sh Case 3 -- even when the slices run sequentially, since a slice
# advances its shard, never state.json. The command tags such a spawn with a
# `team-slice: <plan|test-plan|uxui>` token in the worker prompt/description; detect
# it and skip the marker. The slice owns its shard and never trips the Phase-2
# freshness guard; the canonical state.json is folded single-writer at the gate
# (orchestrator.md > State discipline > Team-mode Phase-1 sharding).
slice_payload="$(printf '%s' "$input" | jq -r '[(.tool_input.prompt // ""), (.tool_input.description // "")] | join("\n")')"
if printf '%s' "$slice_payload" | grep -qiE 'team-slice:[[:space:]]*(plan|test-plan|uxui)'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
WF_DIR="$PROJECT_DIR/.workflow"
[[ -d "$WF_DIR" ]] || exit 0

# Identify the active /dev run whose marker to touch. Prefer the orchestrator's
# explicit, concurrency-safe signal $CLAUDE_DEV_RUN_ID — the SAME knob the
# PreToolUse guard (dev-agent-guard.sh Case 3) scopes its freshness check to.
# Without this, the two hooks disagree on "which run": this hook used to pick
# the most-recently-modified state.json, and during an implement fanout THIS
# run's state.json is repeatedly the newest (written on every phase completion),
# so a concurrent sibling run's worker return could cross-touch THIS run's
# marker and false-block its next spawn — the exact failure the guard's
# run-scoping exists to prevent. Match dev-agent-guard.sh Case 3: if no explicit
# run id is set, fall back only when there is exactly one active run; with 0 or
# 2+ active runs, fail open and skip the marker rather than guessing.
latest_state=""
if [[ -n "${CLAUDE_DEV_RUN_ID:-}" ]] && [[ -f "$WF_DIR/$CLAUDE_DEV_RUN_ID/state.json" ]]; then
  latest_state="$WF_DIR/$CLAUDE_DEV_RUN_ID/state.json"
else
  active_count=0
  for f in "$WF_DIR"/*/state.json; do
    [[ -f "$f" ]] || continue
    # _templates holds the blueprint state.json, not a run — never mark it
    [[ "$(basename "$(dirname "$f")")" == "_templates" ]] && continue
    active_count=$((active_count + 1))
    latest_state="$f"
  done
  [[ "$active_count" -eq 1 ]] || latest_state=""
fi

[[ -n "$latest_state" ]] || exit 0

run_dir="$(dirname "$latest_state")"
run_id="$(basename "$run_dir")"
touch "$run_dir/.last_worker_return"

# Read the current step from state.json so the reminder can name what's
# expected next. Fail-soft: if the file is malformed, omit the step hint.
cur_phase="$(jq -r '.phase // ""' "$latest_state" 2>/dev/null || printf '')"
cur_step="$(jq -r '.step // ""' "$latest_state" 2>/dev/null || printf '')"

reminder=$(cat <<EOF
[/dev state discipline] Worker \`${subagent_type}\` just returned for run \`${run_id}\` (phase=${cur_phase:-?}, step=${cur_step:-?}).

BEFORE your next \`Agent\` spawn, update \`.workflow/${run_id}/state.json\` via Write/Edit with:
  - \`phase\`: current phase
  - \`step\`: the step you just completed
  - \`next_step\`: per the type matrix in WORKFLOW.md (use \`"skipped:<reason>"\` for matrix-skipped steps)
  - \`cycles.review\` / \`cycles.test\`: bump only on actual cycle increments
  - \`last_updated\`: fresh ISO timestamp
  - \`last_agent\`: \`${subagent_type}\`

The PreToolUse guard (\`.claude/hooks/dev-agent-guard.sh\` Case 3) blocks the next worker spawn until the mtime of \`state.json\` is newer than \`.last_worker_return\`. Skipping this is the single most common reason a /dev run gets BLOCKED and needs \`/dev --resume\`.
EOF
)

jq -n --arg ctx "$reminder" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'

exit 0
