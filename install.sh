#!/usr/bin/env bash
# claude-foundation installer — drop the /dev workflow into a target project.
#
# Usage:
#   ./install.sh [target-path] [--source <path>] [--force] [--yes] [--dry-run]
#
# Default target is the current directory. Default source is the directory
# this script lives in.

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── ANSI colors (off when not a TTY) ────────────────────────────────────────
if [ -t 1 ]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; B=$'\033[0;34m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; D=''; N=''
fi

info() { printf "%s\n" "${B}▸${N} $*"; }
ok()   { printf "%s\n" "${G}✓${N} $*"; }
warn() { printf "%s\n" "${Y}⚠${N} $*" >&2; }
fail() { printf "%s\n" "${R}✗${N} $*" >&2; exit 1; }

usage() {
  cat <<EOF
${SCRIPT_NAME} — install the /dev workflow into a project

Usage:
  ${SCRIPT_NAME} [target-path] [options]
  ${SCRIPT_NAME} dashboard-up --key <key>   Start team-presence client (background)
  ${SCRIPT_NAME} dashboard-down             Stop the presence client
  ${SCRIPT_NAME} dashboard-status           Is the presence client running?

Arguments:
  target-path        Where to install (default: current directory)

Options:
  --source <path>    Source repo (default: directory containing this script)
  --force, -f        Also overwrite settings.json (foundation-owned files
                     are already refreshed on every run)
  --yes, -y          Skip the confirmation prompt
  --dry-run          Print the plan, write nothing
  -h, --help         Show this help

What gets installed:
  .claude/agents/**            — pm, lead, engineer, qa, retro + team-* fan-out workers + TEAM.md (always refreshed)
  .claude/orchestrator.md      — orchestrator script run by the main agent on /dev, NOT a sub-agent (always refreshed)
  .claude/orchestrator/references/** — on-demand orchestrator detail (fanout, resume, state edge cases) the core loads only when that path fires (always refreshed)
  .claude/commands/**          — /dev plus the team-mode commands (/spec, /test-plan, /uxui-plan) (always refreshed)
  .claude/skills/**            — fundamentals (coding-discipline, ddd-strategic, programming, concurrency, database, hexagonal, architecture, queue, security, observability, debug, refactoring, testing, git-workflow, delivery-engineering) + product skills (brainstorming, plan-writing, fanout-team-agents, frontend-design, tailwind-design-system, ui-ux-pro-max, skill-creator) (always refreshed)
  .claude/rules/*.md           — always-on pointers to the skills above (always refreshed)
  .claude/hooks/**             — every hook script in the foundation (lint, dev-agent-guard, dev-state-mark, protect-secrets, …) — copied verbatim, always refreshed
  .claude/settings.json        — hook wiring, derived from this file's own hooks block (only if missing; existing files get a merge — see below)
  .workflow/_templates/*       — spec/plan/test-plan/uxui-plan/review/security/tests/recommendations/retro/epic + state.json (always refreshed)
  .workflow/INDEX.md           — fresh registry (only if missing)
  .workflow/FOLLOWUPS.md       — follow-up registry (only if missing)
  WORKFLOW.md                  — full flow reference at repo root (always refreshed)
  CLAUDE.md                    — full stub if missing; otherwise the always-on
                                 rules-import fallback block is appended if absent
                                 (idempotent, existing content preserved)

Behavior:
  - Foundation-owned files (agents, orchestrator, commands, skills, rules,
      hooks, templates, WORKFLOW.md) are ALWAYS refreshed on every run so
      upstream skill/agent updates land. If you've forked one locally and
      don't want it clobbered, move it out of these paths.
  - .workflow/INDEX.md & .workflow/FOLLOWUPS.md: never overwritten (user state)
  - CLAUDE.md: the full file is never overwritten; if it already exists we
      append ONLY the always-on rules-import fallback block when it's missing
      (idempotent — re-runs add nothing; existing content preserved)
  - .claude/settings.local.json is never touched (user-local config)
  - settings.json wiring: if the target already has .claude/settings.json
      and any hook declared in our source .claude/settings.json isn't wired
      in, we try to merge
      automatically. The merge uses jq, is
      idempotent (re-running adds nothing new), preserves the user's other
      fields (permissions, model, env, their own hooks), writes a backup
      next to the file as settings.json.backup-YYYYMMDD-HHMMSS, and
      validates the result is still parseable JSON before overwriting.
      Falls back to dropping a snippet at .claude/settings.foundation.json
      with hand-merge instructions if jq isn't installed or the merge
      fails.
  - Upgrade cleanup: files removed by a newer foundation version (e.g. the
      legacy .claude/agents/orchestrator.md sub-agent / redirect stub) are
      deleted from the target on every run. The CLEANUP array in this script
      is the source of truth — extend it whenever a fix removes a previously-
      installed file.
EOF
}

# ── Parse args ──────────────────────────────────────────────────────────────
TARGET_PATH=""
SOURCE_PATH="$SCRIPT_DIR"
FORCE="no"
ASSUME_YES="no"
DRY_RUN="no"

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --source)
      [ $# -ge 2 ] || fail "--source needs a path"
      SOURCE_PATH="$2"; shift ;;
    -f|--force)   FORCE="yes" ;;
    -y|--yes)     ASSUME_YES="yes" ;;
    --dry-run)    DRY_RUN="yes" ;;
    -*)           fail "Unknown option: $1" ;;
    *)
      [ -z "$TARGET_PATH" ] || fail "Unexpected positional argument: $1"
      TARGET_PATH="$1" ;;
  esac
  shift
done

expand_path() {
  local p="$1"
  case "$p" in "~"|"~/"*) p="${HOME}${p#\~}" ;; esac
  if [ -d "$p" ]; then
    ( cd "$p" && pwd )
  else
    local parent base
    parent="$(dirname "$p")"
    base="$(basename "$p")"
    if [ -d "$parent" ]; then
      printf "%s/%s\n" "$(cd "$parent" && pwd)" "$base"
    else
      printf "%s\n" "$p"
    fi
  fi
}

TARGET_PATH="${TARGET_PATH:-$PWD}"
TARGET_PATH="$(expand_path "$TARGET_PATH")"
SOURCE_PATH="$(expand_path "$SOURCE_PATH")"

# ── Validate source ─────────────────────────────────────────────────────────
[ -d "$SOURCE_PATH" ] || fail "source not found: $SOURCE_PATH"
for needed in \
  ".claude/agents" \
  ".claude/orchestrator.md" \
  ".claude/commands" \
  ".claude/commands/dev.md" \
  ".claude/skills" \
  ".claude/rules" \
  ".claude/hooks" \
  ".claude/settings.json" \
  ".workflow/_templates" \
  ".workflow/_templates/state.json" \
  ".workflow/FOLLOWUPS.md" \
  "WORKFLOW.md"; do
  [ -e "$SOURCE_PATH/$needed" ] || fail "source is missing $needed — pass --source with the claude-foundation repo path"
done
ok "source: $SOURCE_PATH"

# ── Validate / create target ────────────────────────────────────────────────
if [ ! -d "$TARGET_PATH" ]; then
  if [ "$ASSUME_YES" = "yes" ] || [ "$DRY_RUN" = "yes" ]; then
    [ "$DRY_RUN" = "yes" ] || mkdir -p "$TARGET_PATH"
  else
    printf "Target %s doesn't exist. Create it? [y/N] " "$TARGET_PATH"
    read -r ans
    case "$ans" in y|Y|yes|YES) mkdir -p "$TARGET_PATH" ;; *) fail "aborted" ;; esac
  fi
fi
[ "$DRY_RUN" = "yes" ] || TARGET_PATH="$(expand_path "$TARGET_PATH")"

# Self-copy guard
case "$TARGET_PATH" in
  "$SOURCE_PATH"|"$SOURCE_PATH"/*) fail "target ($TARGET_PATH) is the same as or inside source ($SOURCE_PATH)" ;;
esac
ok "target: $TARGET_PATH"

# ── Plan ────────────────────────────────────────────────────────────────────
# Each row: "<src-relative-path>|<mode>"
# mode = skip-if-exists | force-overwrite | always-overwrite | never-overwrite
#
# A row whose path is a directory in the source is expanded into one row per
# file beneath it (recursive), each inheriting the same mode. That keeps the
# dry-run output file-accurate without a 30-line manual enumeration.
PLAN=(
  ".claude/orchestrator.md|always-overwrite"
  ".claude/orchestrator/references|always-overwrite"
  ".claude/agents|always-overwrite"
  ".claude/commands|always-overwrite"
  ".claude/skills|always-overwrite"
  ".claude/rules|always-overwrite"
  ".claude/hooks|always-overwrite"
  ".claude/settings.json|skip-if-exists"
  ".workflow/_templates/spec.md|always-overwrite"
  ".workflow/_templates/plan.md|always-overwrite"
  ".workflow/_templates/test-plan.md|always-overwrite"
  ".workflow/_templates/uxui-plan.md|always-overwrite"
  ".workflow/_templates/review.md|always-overwrite"
  ".workflow/_templates/security.md|always-overwrite"
  ".workflow/_templates/tests.md|always-overwrite"
  ".workflow/_templates/recommendations.md|always-overwrite"
  ".workflow/_templates/retro.md|always-overwrite"
  ".workflow/_templates/epic.md|always-overwrite"
  ".workflow/_templates/state.json|always-overwrite"
  ".workflow/INDEX.md|never-overwrite"
  ".workflow/FOLLOWUPS.md|never-overwrite"
  "WORKFLOW.md|always-overwrite"
)

# Files removed by a previous foundation version that must be deleted from
# upgraded targets (otherwise stale sub-agent / command files keep registering
# and the new flow breaks). Each row is "<target-relative-path>|<why>".
# Add a row whenever a fix removes a file the installer used to write.
CLEANUP=(
  ".claude/agents/orchestrator.md|no orchestrator sub-agent — orchestration runs in the main agent (see .claude/orchestrator.md)"
  # The per-skill rule files were consolidated into the single fundamentals.md
  # router. Claude Code auto-loads the whole .claude/rules/ dir, so a stale copy
  # would load the old router alongside the new one — delete them on upgrade.
  ".claude/rules/coding-discipline.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/ddd-strategic.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/programming-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/concurrency-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/database-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/hexagonal-backend.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/api-design-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/architecture-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/queue-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/security-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/observability-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/debug-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/refactoring-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/testing-fundamentals.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/git-workflow.md|consolidated into .claude/rules/fundamentals.md"
  ".claude/rules/delivery-engineering.md|consolidated into .claude/rules/fundamentals.md"
)

# Expand directory rows into per-file rows.
EXPANDED_PLAN=()
for row in "${PLAN[@]}"; do
  rel="${row%|*}"; mode="${row#*|}"
  src="$SOURCE_PATH/$rel"
  if [ -d "$src" ]; then
    while IFS= read -r -d '' file; do
      sub_rel="${file#"$SOURCE_PATH"/}"
      EXPANDED_PLAN+=("$sub_rel|$mode")
    done < <(find "$src" -type f -print0 | LC_ALL=C sort -z)
  else
    EXPANDED_PLAN+=("$row")
  fi
done
PLAN=("${EXPANDED_PLAN[@]}")

resolve_action() {
  local mode="$1" dst="$2"
  case "$mode" in
    skip-if-exists)
      if [ ! -e "$dst" ]; then echo "copy"
      elif [ "$FORCE" = "yes" ]; then echo "overwrite"
      else echo "skip"; fi ;;
    always-overwrite)
      if [ ! -e "$dst" ]; then echo "copy"; else echo "overwrite"; fi ;;
    never-overwrite)
      if [ ! -e "$dst" ]; then echo "copy"; else echo "skip"; fi ;;
    *) echo "skip" ;;
  esac
}

info "Plan"
NEW=0; OVR=0; SKP=0
for row in "${PLAN[@]}"; do
  rel="${row%|*}"; mode="${row#*|}"
  src="$SOURCE_PATH/$rel"
  dst="$TARGET_PATH/$rel"
  if [ ! -e "$src" ]; then
    printf "  ${D}? %s — missing in source${N}\n" "$rel"
    continue
  fi
  action="$(resolve_action "$mode" "$dst")"
  case "$action" in
    copy)      printf "  ${G}+${N} %s\n" "$rel"; NEW=$((NEW+1)) ;;
    overwrite) printf "  ${Y}~${N} %s ${D}(overwrite)${N}\n" "$rel"; OVR=$((OVR+1)) ;;
    skip)      printf "  ${D}=${N} %s ${D}(kept)${N}\n" "$rel"; SKP=$((SKP+1)) ;;
  esac
done
printf "\n  Summary: ${G}%d new${N}, ${Y}%d overwrite${N}, ${D}%d kept${N}\n" "$NEW" "$OVR" "$SKP"

# Show cleanup plan — files that exist in the target and will be deleted on apply.
CLEANUP_HITS=0
for row in ${CLEANUP[@]+"${CLEANUP[@]}"}; do
  rel="${row%%|*}"; why="${row#*|}"
  dst="$TARGET_PATH/$rel"
  if [ -e "$dst" ]; then
    printf "  ${R}-${N} %s ${D}(remove: %s)${N}\n" "$rel" "$why"
    CLEANUP_HITS=$((CLEANUP_HITS+1))
  fi
done
if [ "$CLEANUP_HITS" -gt 0 ]; then
  printf "  ${R}%d to remove${N}\n" "$CLEANUP_HITS"
fi

# CLAUDE.md (separate from PLAN — generated/merged, not copied). Created with a
# full stub when absent; otherwise we append ONLY the always-on rules-import
# fallback block when it's missing, preserving the user's existing content.
# emit_rules_block is the single source of truth for that block — used both for
# the fresh stub and the append path. RULES_IMPORT_MARKER is the idempotency key
# (the first import line); if it's already in CLAUDE.md the block is present.
#
# NOTE: the marker is a *first-write freeze*, not a sync. Once the block exists
# in a target's CLAUDE.md we never touch it again — so if this foundation later
# adds/renames/removes a rule, an existing block won't pick up the change. That
# is acceptable because the block is only a fallback (recent Claude Code
# auto-loads .claude/rules/) and the rule *files* themselves always refresh; the
# stale-fallback window is (old Claude Code × rule-set change). If that ever
# needs to re-sync, wrap the block in sentinel comments and replace between them.
emit_rules_block() {
  cat <<'BLOCK'
<!-- claude-foundation:rules-imports:start (managed block — re-synced by install.sh; edit rules in .claude/rules/, not here) -->
## Always-on fundamentals

The `/dev` workflow's "by default" rules live in `.claude/rules/`. Recent Claude Code auto-loads that directory as project memory; the explicit import below is a fallback so the fundamentals still load on versions that do NOT auto-load `.claude/rules/`. If your Claude Code already auto-loads them, this import is redundant but harmless — delete this section if you ever see the router loaded twice.

@.claude/rules/fundamentals.md
<!-- claude-foundation:rules-imports:end -->
BLOCK
}
SENTINEL_START="<!-- claude-foundation:rules-imports:start"
SENTINEL_END="<!-- claude-foundation:rules-imports:end -->"
# Legacy idempotency key (pre-sentinel blocks, installed before the rules were
# consolidated into the single fundamentals.md router). Matching it on an old
# target triggers the upgrade path that replaces the multi-import block.
RULES_IMPORT_MARKER="@.claude/rules/coding-discipline.md"

CLAUDE_DST="$TARGET_PATH/CLAUDE.md"
if [ ! -e "$CLAUDE_DST" ]; then
  printf "  ${G}+${N} CLAUDE.md ${D}(stub — points at WORKFLOW.md + rules-import fallback)${N}\n"
elif grep -qF "$SENTINEL_START" "$CLAUDE_DST" 2>/dev/null; then
  printf "  ${G}~${N} CLAUDE.md ${D}(re-sync managed rules-import block)${N}\n"
elif grep -qF "$RULES_IMPORT_MARKER" "$CLAUDE_DST" 2>/dev/null; then
  printf "  ${G}~${N} CLAUDE.md ${D}(upgrade legacy rules-import block → managed block)${N}\n"
else
  printf "  ${G}~${N} CLAUDE.md ${D}(append always-on rules-import fallback)${N}\n"
fi

# settings.json hook check. PLAN keeps the existing settings.json so we never
# clobber user permissions/model/env config. If the target already has
# settings.json but our hooks aren't fully wired, we'd rather *merge* than
# leave a manual step lying around. Strategy:
#   - If jq is available → auto-merge our Pre/PostToolUse entries (idempotent,
#     existing user hooks/permissions preserved, backup written, output
#     validated as JSON before overwriting).
#   - If jq is missing (or merge fails) → fall back to dropping the snippet
#     at .claude/settings.foundation.json with hand-merge instructions.
SETTINGS_SRC="$SOURCE_PATH/.claude/settings.json"
SETTINGS_DST="$TARGET_PATH/.claude/settings.json"
SETTINGS_SNIPPET="$TARGET_PATH/.claude/settings.foundation.json"
SETTINGS_BACKUP=""
SETTINGS_ACTION="none"
SETTINGS_MERGE_ADDED=""
if [ -e "$SETTINGS_DST" ] && [ -e "$SETTINGS_SRC" ]; then
  # Single source of truth: the hook scripts our *source* settings.json wires.
  # Deriving the desired set here (instead of hardcoding hook names) means a new
  # hook is picked up automatically — adding/removing one needs editing
  # .claude/settings.json only, never this installer. The grep shortcut assumes
  # hook commands are .sh paths under hooks/ (which the foundation guarantees);
  # the jq merge below is fully general and wires whatever shape the source has.
  SRC_HOOK_SCRIPTS="$(grep -oE 'hooks/[A-Za-z0-9._-]+\.sh' "$SETTINGS_SRC" 2>/dev/null | sort -u)"
  for h in $SRC_HOOK_SCRIPTS; do
    grep -q "$h" "$SETTINGS_DST" 2>/dev/null || SETTINGS_MERGE_ADDED+="${h##*/} "
  done
  if [ -z "$SETTINGS_MERGE_ADDED" ]; then
    SETTINGS_ACTION="hook-already-wired"
  elif command -v jq >/dev/null 2>&1; then
    SETTINGS_ACTION="auto-merge"
    printf "  ${G}~${N} .claude/settings.json ${D}(will merge: %s— backup will be written next to it)${N}\n" "$SETTINGS_MERGE_ADDED"
  else
    SETTINGS_ACTION="write-snippet"
    printf "  ${Y}!${N} .claude/settings.json ${D}(kept — jq not found, hooks not fully wired; will drop snippet at .claude/settings.foundation.json for you to merge)${N}\n"
  fi
fi

if [ "$DRY_RUN" = "yes" ]; then
  printf "\n${Y}✓ Dry run complete. Re-run without --dry-run to apply.${N}\n"
  exit 0
fi

if [ "$ASSUME_YES" != "yes" ]; then
  printf "\nProceed? [y/N] "
  read -r ans
  case "$ans" in y|Y|yes|YES) : ;; *) fail "aborted" ;; esac
fi

# ── Apply ───────────────────────────────────────────────────────────────────
info "Installing"
for row in "${PLAN[@]}"; do
  rel="${row%|*}"; mode="${row#*|}"
  src="$SOURCE_PATH/$rel"
  dst="$TARGET_PATH/$rel"
  [ -e "$src" ] || continue
  action="$(resolve_action "$mode" "$dst")"
  case "$action" in
    copy|overwrite)
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst" ;;
    skip) : ;;
  esac
done

# Upgrade cleanup: walk the CLEANUP array and delete any legacy files that earlier
# foundation versions installed but newer versions removed (e.g., a sub-agent that
# became a main-agent script). Without this step, stale .claude/agents/*.md files
# would keep registering as sub-agents and break the new flow.
REMOVED=0
for row in ${CLEANUP[@]+"${CLEANUP[@]}"}; do
  rel="${row%%|*}"; why="${row#*|}"
  dst="$TARGET_PATH/$rel"
  if [ -e "$dst" ]; then
    printf "  ${R}-${N} %s ${D}(%s)${N}\n" "$rel" "$why"
    rm -f "$dst"
    REMOVED=$((REMOVED+1))
  fi
done

# settings.json wiring when target already has its own settings.json.
#
# auto-merge path (preferred): use jq to add our Pre/PostToolUse entries to
# the existing settings.json without touching the user's other fields
# (permissions, model, env, their own hooks). Idempotent — the jq filter
# skips entries whose command is already present. Backs the original up
# alongside the file, validates the output is still parseable JSON, and
# only then overwrites. If anything goes wrong, fall back to snippet.
#
# write-snippet path (fallback): jq missing or merge failed — drop our full
# settings.json next to the target's as .claude/settings.foundation.json
# with hand-merge instructions.
if [ "$SETTINGS_ACTION" = "auto-merge" ]; then
  ts="$(date +%Y%m%d-%H%M%S)"
  SETTINGS_BACKUP="$SETTINGS_DST.backup-$ts"
  cp "$SETTINGS_DST" "$SETTINGS_BACKUP"

  # Data-driven & idempotent: read every (event, matcher, hook) declared in our
  # source settings.json ($src) and upsert each into the target. For each, find
  # the matcher entry under .hooks[event] (creating it if absent), then add the
  # hook into its .hooks list only if no entry with the same command is already
  # present. This preserves the user's own hooks/permissions/model/env, and a
  # new foundation hook is picked up automatically — no edit to this installer.
  # `|| true` keeps `set -e` from aborting on jq failure (invalid JSON input) —
  # we want to fall through to the snippet fallback.
  merged="$(jq --slurpfile src "$SETTINGS_SRC" '
    def upsert_hook($event; $matcher; $hook):
      .hooks //= {} |
      .hooks[$event] //= [] |
      .hooks[$event] = (
        if (.hooks[$event] | any(.matcher == $matcher)) then
          .hooks[$event] | map(
            if .matcher == $matcher then
              .hooks = (
                if (.hooks | any(.command == $hook.command))
                then .hooks
                else (.hooks // []) + [$hook]
                end
              )
            else . end
          )
        else
          .hooks[$event] + [{matcher: $matcher, hooks: [$hook]}]
        end
      );
    reduce ($src[0].hooks // {} | to_entries[]) as $ev (.;
      reduce ($ev.value[]) as $entry (.;
        reduce ($entry.hooks[]) as $h (.;
          upsert_hook($ev.key; $entry.matcher; $h)
        )
      )
    )
  ' "$SETTINGS_DST" 2>/dev/null || true)"

  if [ -n "$merged" ] && printf '%s' "$merged" | jq empty >/dev/null 2>&1; then
    printf '%s\n' "$merged" > "$SETTINGS_DST"
    printf "  ${G}~${N} merged %s ${D}(added: %s| backup at %s)${N}\n" \
      ".claude/settings.json" "$SETTINGS_MERGE_ADDED" "$(basename "$SETTINGS_BACKUP")"
  else
    # Merge failed (probably invalid JSON in target) — restore from backup
    # and drop the snippet instead.
    cp "$SETTINGS_BACKUP" "$SETTINGS_DST"
    rm -f "$SETTINGS_BACKUP"
    SETTINGS_BACKUP=""
    SETTINGS_ACTION="write-snippet"
    printf "  ${Y}!${N} auto-merge failed (settings.json may be invalid JSON) — falling back to snippet drop\n"
  fi
fi

if [ "$SETTINGS_ACTION" = "write-snippet" ]; then
  mkdir -p "$(dirname "$SETTINGS_SNIPPET")"
  cp "$SETTINGS_SRC" "$SETTINGS_SNIPPET"
  printf "  ${Y}!${N} wrote %s ${D}(see merge instructions below)${N}\n" ".claude/settings.foundation.json"
fi

# CLAUDE.md: write the full stub when absent; otherwise append ONLY the
# always-on rules-import fallback block when it's missing. Existing user content
# is always preserved (we only ever append). Keyed on RULES_IMPORT_MARKER for
# idempotency — re-running adds nothing.
CLAUDE_ACTION="kept"
if [ ! -e "$CLAUDE_DST" ]; then
  cat > "$CLAUDE_DST" <<'EOF'
# CLAUDE.md

Project uses the claude-foundation `/dev` workflow.

Entry point: `/dev <intent>` (or `/dev --resume <id>`) — spec → plan → gate → implement → review → (security) → test → docs → ship → retro.

The flow is type-aware: `feat` / `fix` / `refactor` / `chore` / `docs` / `spike` each skip or specialise some phases (e.g., `fix` writes its regression test before the fix; `chore` skips QA; `spike` produces `recommendations.md` instead of code).

Full flow: see `WORKFLOW.md`.
Agents live under `.claude/agents/`; run artifacts land in `.workflow/<id>/`; cross-run state lives in `.workflow/INDEX.md` and `.workflow/FOLLOWUPS.md`.

EOF
  emit_rules_block >> "$CLAUDE_DST"
  CLAUDE_ACTION="created"
elif grep -qF "$SENTINEL_START" "$CLAUDE_DST" 2>/dev/null; then
  # Managed block present — re-sync its contents in place (this is how a rule-set
  # change reaches an existing adopter). Replace everything between the sentinels.
  # The fresh block is read from a temp file (NOT awk -v): BSD awk on macOS rejects
  # a newline inside a -v variable, so a multi-line -v silently fails the re-sync
  # and leaves the stale block in place.
  if command -v awk >/dev/null 2>&1; then
    BLOCK_TMP="$(mktemp)"
    emit_rules_block > "$BLOCK_TMP"
    awk '
      FNR==NR {repl=repl $0 ORS; next}
      $0 ~ /claude-foundation:rules-imports:start/ {printf "%s", repl; skip=1; next}
      $0 ~ /claude-foundation:rules-imports:end/   {skip=0; next}
      skip!=1 {print}
    ' "$BLOCK_TMP" "$CLAUDE_DST" > "$CLAUDE_DST.tmp" && mv "$CLAUDE_DST.tmp" "$CLAUDE_DST"
    rm -f "$BLOCK_TMP"
    CLAUDE_ACTION="resynced"
  fi
elif grep -qF "$RULES_IMPORT_MARKER" "$CLAUDE_DST" 2>/dev/null; then
  # Legacy pre-sentinel block (frozen before the rule set grew, so it is missing
  # the newer rules — including security-fundamentals). Append the managed block;
  # the duplicate imports are redundant-but-harmless per the block's own note, and
  # the next install re-syncs in place via the sentinels just added.
  { printf '\n'; emit_rules_block; } >> "$CLAUDE_DST"
  CLAUDE_ACTION="upgraded"
else
  { printf '\n'; emit_rules_block; } >> "$CLAUDE_DST"
  CLAUDE_ACTION="appended"
fi
case "$CLAUDE_ACTION" in
  created)  printf "  ${G}+${N} CLAUDE.md ${D}(stub + rules-import fallback)${N}\n" ;;
  resynced) printf "  ${G}~${N} CLAUDE.md ${D}(re-synced managed rules-import block)${N}\n" ;;
  upgraded) printf "  ${G}~${N} CLAUDE.md ${D}(upgraded legacy rules-import block → managed)${N}\n" ;;
  appended) printf "  ${G}~${N} CLAUDE.md ${D}(appended always-on rules-import fallback)${N}\n" ;;
  kept)     printf "  ${D}=${N} CLAUDE.md ${D}(kept — rules-import already present)${N}\n" ;;
esac

ok "files written"

# ── Summary ─────────────────────────────────────────────────────────────────
printf "\n${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
printf "${G}✓ claude-foundation installed${N} at %s\n" "$TARGET_PATH"
printf "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
cat <<EOF

  Files     : ${NEW} new, ${OVR} overwritten, ${SKP} kept, ${REMOVED:-0} removed

  Next steps:
    1. Open the project in Claude Code
    2. Run:  /dev <intent>
    3. Review WORKFLOW.md for the full flow definition
EOF

if [ "$SETTINGS_ACTION" = "write-snippet" ]; then
  cat <<EOF

  ${Y}⚠ settings.json already existed in your project — kept as-is.${N}
  Our hooks are NOT fully wired in. To enable them:

    1. Open .claude/settings.foundation.json (we just wrote it).
    2. Copy its "hooks" entries (the PreToolUse + PostToolUse guards: lint,
       dev-agent-guard, dev-state-mark, protect-secrets) into your
       .claude/settings.json. If your settings.json already has those arrays,
       append our entries to the existing lists — don't replace.
    3. Delete .claude/settings.foundation.json.

  If you don't want one of the hooks, just leave its entry out of the merge.
EOF
fi
