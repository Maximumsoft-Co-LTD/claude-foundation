#!/bin/sh
# T109 (improvement-plan.md S1): collect per-run phase_times baseline for before/after measurement.
# Re-run after each slice lands; compare against feedback-notes/baseline.json.
cd "$(dirname "$0")/.." || exit 1
python3 - <<'EOF'
import json, glob

runs = []
for p in sorted(glob.glob('.workflow/*/state.json')):
    try:
        with open(p) as f:
            s = json.load(f)
    except (json.JSONDecodeError, OSError):
        continue
    runs.append({k: s.get(k) for k in (
        'id', 'type', 'size', 'field', 'phase', 'created_at', 'done_at',
        'phase_times', 'cycles', 'skipped_steps')})

out = 'feedback-notes/baseline.json'
with open(out, 'w') as f:
    json.dump({'runs_collected': len(runs), 'runs': runs}, f, indent=1)
print(f"{out}: {len(runs)} runs")
EOF
