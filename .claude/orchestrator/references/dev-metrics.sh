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
# Observed spawn count from the guard hook's append-only ledger. Self-reported
# `spawn_count` has been wrong in practice (0 on a run that spawned `lead`), so
# the two are printed side by side — a mismatch is a finding about the
# orchestrator's bookkeeping, not about the run.
obs="n/a"
[ -f "$dir/.spawn_log" ] && obs="$(wc -l < "$dir/.spawn_log" | tr -d ' ')"
# Which TIER each spawn actually ran at (ledger column 3, `req:` = explicit
# override, `pin:` = the agent file's frontmatter decided). `lead` is the one
# worker allowed to vary, and two lead spawns on the wrong tier is the largest
# cost item a scorecard cannot otherwise see. Ledgers written before the column
# existed have two fields — report "n/a" rather than a misleading empty tally.
tiers="n/a"
if [ -f "$dir/.spawn_log" ] && awk -F'\t' 'NF>=3{f=1} END{exit !f}' "$dir/.spawn_log" 2>/dev/null; then
  tiers="$(awk -F'\t' 'NF>=3{n[$2" "$3]++} END{for (k in n) printf "%s×%d  ", k, n[k]}' "$dir/.spawn_log")"
fi

jq -r --arg obs "$obs" --arg tiers "$tiers" '
  "run:         \(.id)",
  "type/size:   \(.type)/\(.size // "?")   field=\(.field // "?")   profile=\(.work_profile // "?")",
  "route:       risk=\(.risk // "?") ambiguity=\(.ambiguity // "?") volume=\(.volume // "?") coupling=\(.coupling // "?") evidence=\((.evidence // []) | join(","))",
  "spawn_count: \(.spawn_count // "n/a")   (fork/cold sub-agents — inline not counted)",
  "spawn_seen:  \($obs)   (counted by dev-agent-guard.sh; disagreement => a missed state write)",
  "spawn_tiers: \($tiers)   (req: = explicit model override, pin: = agent frontmatter decided)",
  "exec_mode:   \(.exec_mode // {} | to_entries | map("\(.key)=\(.value)") | join("  "))",
  "cycles:      test=\(.cycles.test)  review=\(.cycles.review)",
  "main_budget: \(.orchestrator_budget.turns_observed // "n/a") / target=\(.orchestrator_budget.target_turns // "n/a") / ceiling=\(.orchestrator_budget.hard_ceiling // "n/a") exceeded=\(.orchestrator_budget.exceeded // false)",
  "worker:      \(.worker_lifecycle.status // "legacy") phase=\(.worker_lifecycle.phase // "-") worker=\(.worker_lifecycle.worker // "-")",
  "timing_ms:   elapsed=\(.timing.elapsed_ms // "n/a") active=\(.timing.agent_active_ms // "n/a") human_wait=\(.timing.human_wait_ms // "n/a") worker=\(.timing.worker_runtime_ms // "n/a") worker_wait=\(.timing.worker_wait_ms // "n/a") reconcile=\(.timing.reconcile_ms // "n/a")",
  "skipped:     \(.skipped_steps | join(", "))",
  "phase_times: \(.phase_times // {} | to_entries | map("\(.key)=\(.value)") | join("  "))",
  "wall-clock:  \(.created_at)  ->  \(.done_at // "in-progress")"
' "$sf"
