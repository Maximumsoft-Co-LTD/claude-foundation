#!/bin/sh
set -eu

# Compatibility entrypoint. Version 1 sampled only the parent shell and could
# incorrectly label that diagnostic as release evidence. All new runs use the
# process-tree-aware, versioned workload.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/scripts/performance/mixed-soak-v2.mjs" "${1:-28800}" "${2:-target/performance/mixed-soak-v2.json}"
