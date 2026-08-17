#!/usr/bin/env bash
# OpenCode adapter for the OpenSpec-native Foundation harness.
#
# OpenCode reads .claude/skills/ and AGENTS.md natively, so the shared install
# already covers skills and the agent contract. This adapter adds the two
# surfaces OpenCode does not read from .claude/: slash commands
# (.opencode/commands/) and guard enforcement (.opencode/plugins/, which
# replays the shipped hooks through OpenCode's tool.execute hooks).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PATH=""
SOURCE_PATH="$SCRIPT_DIR"
ASSUME_YES=no
DRY_RUN=no

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || fail "--source needs a path"; SOURCE_PATH="$2"; shift ;;
    --yes|-y) ASSUME_YES=yes ;;
    --dry-run) DRY_RUN=yes ;;
    --force|-f) : ;;
    --help|-h)
      cat <<'EOF'
install-opencode.sh [target-path] [--source path] [--yes] [--dry-run]

Installs the shared Foundation runtime plus OpenCode command and guard
adapters. Skills and AGENTS.md need no adapter: OpenCode reads
.claude/skills/ and AGENTS.md directly.
EOF
      exit 0 ;;
    -*) fail "unknown option: $1" ;;
    *) [ -z "$TARGET_PATH" ] || fail "unexpected argument: $1"; TARGET_PATH="$1" ;;
  esac
  shift
done

TARGET_PATH="${TARGET_PATH:-$PWD}"
mkdir -p "$TARGET_PATH"
TARGET_PATH="$(cd "$TARGET_PATH" && pwd)"
SOURCE_PATH="$(cd "$SOURCE_PATH" && pwd)"

args=("$TARGET_PATH" "--source" "$SOURCE_PATH")
[ "$ASSUME_YES" = no ] || args+=("--yes")
[ "$DRY_RUN" = no ] || args+=("--dry-run")
bash "$SOURCE_PATH/install.sh" "${args[@]}"
[ "$DRY_RUN" = no ] || exit 0

mkdir -p "$TARGET_PATH/.opencode/commands" "$TARGET_PATH/.opencode/plugins"
cp "$SOURCE_PATH/.claude/commands/"*.md "$TARGET_PATH/.opencode/commands/"
cp "$SOURCE_PATH/.claude/harness/adapters/opencode-plugin.js" \
  "$TARGET_PATH/.opencode/plugins/foundation.js"

printf '✓ OpenCode adapter installed at %s\n' "$TARGET_PATH"
printf '  commands: .opencode/commands/ (from .claude/commands/)\n'
printf '  guards:   .opencode/plugins/foundation.js replays .claude/hooks/\n'
printf '  skills + agent contract: read natively from .claude/skills/ and AGENTS.md\n'
printf 'Next: describe the outcome with /change <intent>; the agent handles the workflow details.\n'
