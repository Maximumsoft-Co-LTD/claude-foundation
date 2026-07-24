#!/usr/bin/env sh
# dev-metrics.sh — read a /dev run's state.json and print the speed / mechanism
# metrics used for before/after benchmarking (WORKFLOW.md > measurement).
# Mechanism metrics (spawn_count, exec_mode, size) are DETERMINISTIC — the
# primary proof a change worked; wall-clock/phase_times are noisy (take a median
# across runs). Usage:  sh dev-metrics.sh .workflow/<id>/
set -eu
dir="${1:?usage: dev-metrics.sh <.workflow/<id>/-dir>}"
sf="$dir/state.json"
[ -f "$sf" ] || { echo "no state.json in $dir" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }
jq -r '
  "run:         \(.id)",
  "type/size:   \(.type)/\(.size // "?")   field=\(.field // "?")",
  "spawn_count: \(.spawn_count // "n/a")   (fork/cold sub-agents — inline not counted)",
  "exec_mode:   \(.exec_mode // {} | to_entries | map("\(.key)=\(.value)") | join("  "))",
  "cycles:      test=\(.cycles.test)  review=\(.cycles.review)",
  "skipped:     \(.skipped_steps | join(", "))",
  "phase_times: \(.phase_times // {} | to_entries | map("\(.key)=\(.value)") | join("  "))",
  "wall-clock:  \(.created_at)  ->  \(.done_at // "in-progress")"
' "$sf"
