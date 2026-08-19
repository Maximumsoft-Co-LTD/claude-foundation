#!/usr/bin/env bash
# Codex CLI adapter for the OpenSpec-native Foundation harness.
#
# Codex reads AGENTS.md and project .agents/skills natively. The adapter keeps
# those skills as relative symlinks to the shared Foundation source so Claude
# and Codex cannot drift into different workflows. Custom prompts also remain
# available for older Codex clients, and
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
per-project prompt directory. Project skills land as symlinks under
.agents/skills; AGENTS.md is read directly.
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

# shellcheck source=.claude/harness/adapters/install-support.sh
. "$SOURCE_PATH/.claude/harness/adapters/install-support.sh"
CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
adapter_scope_root() {
  case "$1" in
    project) printf '%s\n' "$TARGET_PATH" ;;
    codex-home) printf '%s\n' "$CODEX_ROOT" ;;
    *) return 1 ;;
  esac
}
adapter_legacy_owned() { return 1; }
adapter_manifest_init codex "$TARGET_PATH"

mkdir -p "$TARGET_PATH/.agents/skills" "$TARGET_PATH/.codex"
for src in "$TARGET_PATH/.claude/skills/"*/SKILL.md; do
  [ -e "$src" ] || continue
  name="$(basename "$(dirname "$src")")"
  dst="$TARGET_PATH/.agents/skills/$name"
  expected="../../.claude/skills/$name"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$expected" ]; then
    adapter_manifest_record project ".agents/skills/$name"
    continue
  fi
  if ! adapter_manifest_may_write project ".agents/skills/$name" "$dst"; then
    printf '⚠ keeping existing Codex skill: %s\n' "$dst" >&2
    continue
  fi
  adapter_manifest_prepare_replacement "$dst"
  ln -s "$expected" "$dst"
  adapter_manifest_record project ".agents/skills/$name"
done
for pair in "foundation-rules:../.claude/rules" "hooks:../.claude/hooks"; do
  name="${pair%%:*}"
  expected="${pair#*:}"
  dst="$TARGET_PATH/.codex/$name"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$expected" ]; then
    adapter_manifest_record project ".codex/$name"
    continue
  fi
  if ! adapter_manifest_may_write project ".codex/$name" "$dst"; then
    printf '⚠ keeping existing Codex compatibility path: %s\n' "$dst" >&2
    continue
  fi
  adapter_manifest_prepare_replacement "$dst"
  ln -s "$expected" "$dst"
  adapter_manifest_record project ".codex/$name"
done

PROMPTS_DIR="$CODEX_ROOT/prompts"
mkdir -p "$PROMPTS_DIR"
if [ "$ADAPTER_MANIFEST_MIGRATING" = yes ]; then
  for dst in "$PROMPTS_DIR/"*.md; do
    [ -f "$dst" ] || continue
    grep -qF "$PROMPT_MARKER" "$dst" || continue
    adapter_manifest_seed_prior codex-home "prompts/$(basename "$dst")"
  done
fi
for src in "$SOURCE_PATH/.claude/commands/"*.md; do
  name="$(basename "$src")"
  dst="$PROMPTS_DIR/$name"
  rel="prompts/$name"
  # The prompt directory is user-global and shared with hand-written prompts.
  # Only files carrying the Foundation marker are ours to refresh; a same-named
  # user prompt is kept and reported rather than clobbered.
  if [ -e "$dst" ] && ! grep -qF "$PROMPT_MARKER" "$dst"; then
    printf '⚠ keeping existing user prompt: %s\n' "$dst" >&2
    adapter_manifest_relinquish codex-home "$rel"
    continue
  fi
  { cat "$src"; printf '\n%s\n' "$PROMPT_MARKER"; } > "$dst"
  adapter_manifest_record codex-home "$rel"
done
adapter_manifest_finish

printf '✓ Codex adapter installed at %s\n' "$TARGET_PATH"
printf '  prompts:        %s (user-global; bodies target the current project)\n' "$PROMPTS_DIR"
printf '  agent contract: read natively from AGENTS.md\n'
printf '  skills:         %s (symlinked to .claude/skills)\n' "$TARGET_PATH/.agents/skills"
printf '  rules/hooks:    %s (compatibility symlinks)\n' "$TARGET_PATH/.codex"
printf '  guards:         Codex has no tool hooks; live guards are inert here.\n'
printf '                  Land gates still enforce; opt in to no-direct-main-commit.sh for git.\n'
adapter_capability_summary \
  "$SOURCE_PATH/.claude/harness/adapters/host-capabilities.json" codex
printf '  telemetry:      claude-foundation telemetry import --format codex\n'
if ! command -v codex >/dev/null 2>&1; then
  printf '  reviewer setup: npm install -g @openai/codex && codex login\n'
else
  printf '  reviewer setup: codex login status\n'
fi
printf 'Next: describe the outcome with /change <intent>; the agent handles the workflow details.\n'
