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

# 0. Stamp the clock. The orchestrator has no clock of its own, so the rule used
#    to be "every timestamp = `$(date -u …)` output — run it, never guess". That
#    guarantee is worth keeping (a hand-typed ISO is hallucinated) but the shell
#    -out is not: a turn inventory of an XS run counted SEVEN separate `date -u`
#    Bash calls, each its own turn, each re-sending the whole context. Cost on
#    this workflow tracks turns, not bytes — two ~26 KB instruction cuts moved it
#    under 1%, while bookkeeping was ~44% of all tool calls.
#
#    So the orchestrator now writes the literal sentinel "__now__" wherever a
#    timestamp goes and this hook substitutes real UTC after the write. The model
#    still never types a clock value; it just stops paying a turn to read one.
#    Substitution runs BEFORE the validity checks so they see final content, and
#    it cannot break parseability — a JSON string is replaced by a JSON string.
if grep -q '"__now__"' "$fp" 2>/dev/null; then
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp="$fp.now.$$"
  if sed "s/\"__now__\"/\"$now\"/g" "$fp" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$fp"
  else
    rm -f "$tmp"
  fi
fi

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

# 2. No duplicated key. jq silently keeps the LAST of a duplicate, so a dup
#    parses clean but means a targeted Edit inserted a second copy instead of
#    replacing the value — the two-`notes`-keys corruption class. Primary check
#    is python3's object_pairs_hook (exact, indent-proof, catches nested dups);
#    without python3 fall back to the old 2-space-indent grep heuristic, which
#    only sees the canonical layout's object root.
key=""
if command -v python3 >/dev/null 2>&1; then
  key="$(python3 - "$fp" 2>/dev/null <<'PY' || true
import json, sys

def pairs(p):
    seen = set()
    for k, _ in p:
        if k in seen:
            print(k)
            sys.exit(0)
        seen.add(k)
    return dict(p)

try:
    with open(sys.argv[1]) as f:
        json.load(f, object_pairs_hook=pairs)
except SystemExit:
    raise
except Exception:
    pass
PY
)"
else
  dup="$(grep -oE '^  "[A-Za-z0-9_]+"[[:space:]]*:' "$fp" 2>/dev/null | sort | uniq -d | head -1 || true)"
  [[ -n "$dup" ]] && key="$(printf '%s' "$dup" | sed -E 's/^  "([A-Za-z0-9_]+)".*/\1/')"
fi
if [[ -n "$key" ]]; then
  emit_block "BLOCKED by /dev state validator: $fp has a duplicate key \"$key\" — a targeted Edit must REPLACE an existing key's value, never insert a second copy (this is the corruption that breaks /dev --resume). Re-Write the COMPLETE object with exactly one of each key."
fi

exit 0
