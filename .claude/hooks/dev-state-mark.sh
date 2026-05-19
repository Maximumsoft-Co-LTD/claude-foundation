#!/usr/bin/env bash
# PostToolUse marker for the /dev workflow.
#
# When a /dev worker sub-agent (pm | lead | engineer | qa | retro) returns,
# touch a marker file in the most-recently-modified .workflow/<id>/ dir.
# The companion PreToolUse check in dev-agent-guard.sh refuses to spawn the
# next worker until state.json has been updated past that marker.
#
# This is the structural enforcement behind orchestrator.md > State discipline
# ("after EVERY step, update state.json"). Without it, the rule is prose only
# and the main agent forgets the bookkeeping step between worker spawns.

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

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
WF_DIR="$PROJECT_DIR/.workflow"
[[ -d "$WF_DIR" ]] || exit 0

# Find the most recently modified .workflow/<id>/state.json — that's the
# active /dev run. If there isn't one, this Agent call isn't part of /dev.
latest_state=""
for f in "$WF_DIR"/*/state.json; do
  [[ -f "$f" ]] || continue
  if [[ -z "$latest_state" ]] || [[ "$f" -nt "$latest_state" ]]; then
    latest_state="$f"
  fi
done

[[ -n "$latest_state" ]] || exit 0

run_dir="$(dirname "$latest_state")"
touch "$run_dir/.last_worker_return"

exit 0
