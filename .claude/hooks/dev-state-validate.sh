#!/usr/bin/env bash
# PostToolUse integrity validator for a /dev run's state.json.
#
# Backs the relaxed "Edit is allowed for hot scalar fields" rule in
# orchestrator.md > State discipline. The original rule was "always Write the
# COMPLETE object, never Edit a single key" — a blanket ban whose only purpose
# was to guarantee state.json stayed parseable (a botched single-key Edit once
# left a run with two `notes` keys, which `/dev --resume` could not reload).
# That ban made EVERY per-step bump re-emit the whole growing object. Targeted
# value-Edits are far cheaper; this hook is the safety net that makes them safe:
# after any Write/Edit to a run's state.json it verifies the file still parses
# AND has no duplicated top-level key, and blocks — feeding the reason back to
# the model to fix — when it doesn't. With the net in place the cheap path is
# sound, so the blanket Write rule can be relaxed to "Edit the hot scalars,
# Write on structural change."
#
# Scope: ONLY a run's canonical state.json (…/.workflow/<id>/state.json). The
# blueprint (_templates) and the Phase-1 shards (state.<slice>.json) have their
# own lifecycles and are left alone. Fails OPEN on any ambiguity (no jq, file
# gone, unknown tool) — better to skip a check than to wedge an unrelated edit.

set -euo pipefail

# jq is the only hard dependency. Fail open if absent — losing the check beats
# breaking an unrelated Write/Edit with a non-/dev failure.
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
case "$tool_name" in
  Write|Edit|MultiEdit) ;;
  *) exit 0 ;;
esac

fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"

# Guard only a run's canonical state.json. Match …/.workflow/<id>/state.json but
# NOT …/.workflow/<id>/state.<slice>.json (shards) and NOT _templates.
case "$fp" in
  */_templates/state.json) exit 0 ;;
  */.workflow/*/state.json) ;;
  *) exit 0 ;;
esac

[[ -f "$fp" ]] || exit 0

emit_block() {
  # Surface the reason both ways so it lands regardless of how the running
  # Claude Code version reads PostToolUse output: `decision: block` (prompts
  # the model to reconsider) and additionalContext (always injected).
  jq -n --arg r "$1" '{
    decision: "block",
    reason: $r,
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $r }
  }'
  exit 0
}

# 1. Still valid JSON? `/dev --resume` parses this file verbatim.
if ! jq empty "$fp" 2>/dev/null; then
  emit_block "BLOCKED by /dev state validator: $fp is not valid JSON after this edit — /dev --resume parses it verbatim, so this breaks resume. Re-Write the COMPLETE state.json object as valid JSON, then continue."
fi

# 2. No duplicated top-level key. jq silently keeps the LAST of a duplicate, so
#    a dup parses clean but means a targeted Edit inserted a second copy instead
#    of replacing the value — the two-`notes`-keys corruption class. Top-level
#    keys are 2-space indented in the canonical layout; nested keys are deeper
#    and never match, so this checks only the object root.
dup="$(grep -oE '^  "[A-Za-z0-9_]+"[[:space:]]*:' "$fp" 2>/dev/null | sort | uniq -d | head -1 || true)"
if [[ -n "$dup" ]]; then
  key="$(printf '%s' "$dup" | sed -E 's/^  "([A-Za-z0-9_]+)".*/\1/')"
  emit_block "BLOCKED by /dev state validator: $fp has a duplicate top-level key \"$key\" — a targeted Edit must REPLACE an existing key's value, never insert a second copy (this is the corruption that breaks /dev --resume). Re-Write the COMPLETE object with exactly one of each key."
fi

exit 0
