#!/usr/bin/env bash
# Codex CLI adapter for the OpenSpec-native Foundation harness.
#
# Codex reads AGENTS.md natively, so the shared install already carries the
# agent contract. Custom prompts are the one surface that needs adapting, and
# Codex only reads them from its home directory ($CODEX_HOME/prompts, default
# ~/.codex/prompts) — there is no per-project prompt directory. That is safe
# for these prompts: their bodies drive the `claude-foundation` CLI, which
# resolves whichever project the session is in.
#
# Codex has no tool-call hook system, so the shipped guards
# (.claude/hooks/README.md) do not run live under Codex. Enforcement falls to
# the runtime's own Land gates plus the opt-in git hook
# .claude/hooks/no-direct-main-commit.sh.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PATH=""
SOURCE_PATH="$SCRIPT_DIR"
ASSUME_YES=no
DRY_RUN=no
PROMPT_MARKER='<!-- claude-foundation:prompt -->'

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || fail "--source needs a path"; SOURCE_PATH="$2"; shift ;;
    --yes|-y) ASSUME_YES=yes ;;
    --dry-run) DRY_RUN=yes ;;
    --force|-f) : ;;
    --help|-h)
      cat <<'EOF'
install-codex.sh [target-path] [--source path] [--yes] [--dry-run]

Installs the shared Foundation runtime plus Codex CLI prompt adapters.
Prompts land in $CODEX_HOME/prompts (default ~/.codex/prompts); Codex has no
per-project prompt directory. AGENTS.md needs no adapter: Codex reads it
directly.
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

PROMPTS_DIR="${CODEX_HOME:-$HOME/.codex}/prompts"
mkdir -p "$PROMPTS_DIR"
for src in "$SOURCE_PATH/.claude/commands/"*.md; do
  name="$(basename "$src")"
  dst="$PROMPTS_DIR/$name"
  # The prompt directory is user-global and shared with hand-written prompts.
  # Only files carrying the Foundation marker are ours to refresh; a same-named
  # user prompt is kept and reported rather than clobbered.
  if [ -e "$dst" ] && ! grep -qF "$PROMPT_MARKER" "$dst"; then
    printf '⚠ keeping existing user prompt: %s\n' "$dst" >&2
    continue
  fi
  { cat "$src"; printf '\n%s\n' "$PROMPT_MARKER"; } > "$dst"
done

printf '✓ Codex adapter installed at %s\n' "$TARGET_PATH"
printf '  prompts:        %s (user-global; bodies target the current project)\n' "$PROMPTS_DIR"
printf '  agent contract: read natively from AGENTS.md\n'
printf '  guards:         Codex has no tool hooks; live guards are inert here.\n'
printf '                  Land gates still enforce; opt in to no-direct-main-commit.sh for git.\n'
printf '  telemetry:      claude-foundation telemetry import --format codex\n'
printf 'Next: /change <intent>\n'
