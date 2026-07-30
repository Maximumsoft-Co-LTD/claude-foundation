#!/usr/bin/env bash
# Cursor adapter for the OpenSpec-native Foundation harness.

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
install-cursor.sh [target-path] [--source path] [--yes] [--dry-run]

Installs the shared Foundation runtime plus Cursor command/rule adapters.
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

mkdir -p "$TARGET_PATH/.cursor/commands" "$TARGET_PATH/.cursor/rules"
cp "$SOURCE_PATH/.claude/orchestrator.md" "$TARGET_PATH/.cursor/orchestrator.md"
cp "$SOURCE_PATH/.claude/commands/"*.md "$TARGET_PATH/.cursor/commands/"
cp "$SOURCE_PATH/.claude/rules/fundamentals.md" "$TARGET_PATH/.cursor/rules/fundamentals.mdc"

# Remove exact lifecycle files written by older Cursor adapters.
for old in \
  pm.md lead.md engineer.md qa.md retro.md uxui.md \
  team-best-practice-researcher.md team-code-reviewer.md \
  team-silent-failure-hunter.md team-pr-test-analyzer.md \
  team-codebase-explorer.md team-type-design-analyzer.md; do
  rm -f "$TARGET_PATH/.cursor/agents/$old"
done

printf '✓ Cursor adapter installed at %s\n' "$TARGET_PATH"
printf 'Next: /change <intent>\n'
