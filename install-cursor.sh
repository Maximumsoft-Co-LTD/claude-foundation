#!/usr/bin/env bash
# Cursor adapter for the OpenSpec-native Change Loop harness.

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
[ "$DRY_RUN" = yes ] || mkdir -p "$TARGET_PATH"
if [ -d "$TARGET_PATH" ]; then
  TARGET_PATH="$(cd "$TARGET_PATH" && pwd)"
else
  case "$TARGET_PATH" in /*) ;; *) TARGET_PATH="$PWD/$TARGET_PATH" ;; esac
fi
SOURCE_PATH="$(cd "$SOURCE_PATH" && pwd)"

args=("$TARGET_PATH" "--source" "$SOURCE_PATH")
[ "$ASSUME_YES" = no ] || args+=("--yes")
[ "$DRY_RUN" = no ] || args+=("--dry-run")
bash "$SOURCE_PATH/install.sh" "${args[@]}"
[ "$DRY_RUN" = no ] || exit 0

# shellcheck source=.claude/harness/adapters/install-support.sh
. "$SOURCE_PATH/.claude/harness/adapters/install-support.sh"
adapter_scope_root() {
  [ "$1" = project ] || return 1
  printf '%s\n' "$TARGET_PATH"
}
adapter_legacy_owned() {
  [ "$1" = project ] || return 1
  case "$2" in
    .cursor/orchestrator.md|.cursor/commands/*|.cursor/rules/fundamentals.mdc|.cursor/rules/foundation-human-guidance.mdc) return 0 ;;
    *) return 1 ;;
  esac
}
adapter_manifest_init cursor "$TARGET_PATH"
for retired in \
  .cursor/agents/pm.md .cursor/agents/lead.md .cursor/agents/engineer.md \
  .cursor/agents/qa.md .cursor/agents/retro.md .cursor/agents/uxui.md \
  .cursor/agents/team-best-practice-researcher.md \
  .cursor/agents/team-code-reviewer.md \
  .cursor/agents/team-silent-failure-hunter.md \
  .cursor/agents/team-pr-test-analyzer.md \
  .cursor/agents/team-codebase-explorer.md \
  .cursor/agents/team-type-design-analyzer.md; do
  adapter_manifest_seed_prior project "$retired"
done

install_adapter_file() {
  src="$1"
  rel="$2"
  dst="$TARGET_PATH/$rel"
  if ! adapter_manifest_may_write project "$rel" "$dst"; then
    printf '⚠ keeping existing user-owned Cursor artifact: %s\n' "$dst" >&2
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  adapter_manifest_prepare_file "$dst"
  cp "$src" "$dst"
  adapter_manifest_record project "$rel"
}

mkdir -p "$TARGET_PATH/.cursor/commands" "$TARGET_PATH/.cursor/rules"
install_adapter_file "$SOURCE_PATH/.claude/orchestrator.md" ".cursor/orchestrator.md"
for src in "$SOURCE_PATH/.claude/commands/"*.md; do
  install_adapter_file "$src" ".cursor/commands/$(basename "$src")"
done
# Cursor only applies a rule on every request when its MDC frontmatter says
# so; a bare rename shipped the always-on router as an agent-requested rule.
fundamentals_rel=".cursor/rules/fundamentals.mdc"
fundamentals_dst="$TARGET_PATH/$fundamentals_rel"
if adapter_manifest_may_write project "$fundamentals_rel" "$fundamentals_dst"; then
  adapter_manifest_prepare_file "$fundamentals_dst"
  {
    printf -- '---\ndescription: Foundation always-on skill router\nalwaysApply: true\n---\n\n'
    cat "$SOURCE_PATH/.claude/rules/fundamentals.md"
  } > "$fundamentals_dst"
  adapter_manifest_record project "$fundamentals_rel"
else
  printf '⚠ keeping existing user-owned Cursor artifact: %s\n' "$fundamentals_dst" >&2
fi
install_adapter_file "$SOURCE_PATH/.claude/harness/adapters/cursor-human-guidance.mdc" \
  ".cursor/rules/foundation-human-guidance.mdc"
adapter_manifest_finish

printf '✓ Cursor adapter installed at %s\n' "$TARGET_PATH"
adapter_capability_summary \
  "$SOURCE_PATH/.claude/harness/adapters/host-capabilities.json" cursor
printf 'Next: describe the outcome with /change <intent>; the agent handles the workflow details.\n'
