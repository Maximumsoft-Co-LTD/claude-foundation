#!/usr/bin/env bash
# PreToolUse guard for the /dev workflow.
#
# Catches two known failure modes when the orchestrator (main agent) delegates work:
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

set -euo pipefail

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
[[ "$tool_name" != "Agent" ]] && exit 0

subagent_type="$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // ""')"
description="$(printf '%s' "$input" | jq -r '.tool_input.description // ""')"

# Case 1: orchestrator is never a valid sub-agent
if [[ "$subagent_type" == "orchestrator" ]]; then
  jq -n '{
    decision: "block",
    reason: "BLOCKED by /dev guard: there is no `orchestrator` sub-agent. You — the main agent — ARE the orchestrator. Worker sub-agents you can spawn are: pm, lead, engineer, qa, retro (defined in .claude/agents/). Pick the right one and retry."
  }'
  exit 0
fi

# Case 2: general-purpose fallback with worker-name prefix in description
if [[ "$subagent_type" == "general-purpose" ]]; then
  # case-insensitive match for the worker prefix
  desc_lc="$(printf '%s' "$description" | tr '[:upper:]' '[:lower:]')"
  for worker in pm lead engineer qa retro; do
    # match "<worker>:", "<worker> ", "<worker>(" at the start of the description
    if [[ "$desc_lc" =~ ^${worker}[[:space:]:\(] ]] || [[ "$desc_lc" == "$worker" ]]; then
      jq -n --arg w "$worker" '{
        decision: "block",
        reason: ("BLOCKED by /dev guard: you set subagent_type=\"general-purpose\" but the description starts with \"\($w)\" — that signals you intended to spawn the `\($w)` worker agent. The /dev workflow worker agents live in .claude/agents/ and must be called by name. Retry with subagent_type=\"\($w)\" instead. (Worker agents: pm, lead, engineer, qa, retro.)")
      }'
      exit 0
    fi
  done
fi

exit 0
