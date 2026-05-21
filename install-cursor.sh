#!/usr/bin/env bash
# claude-foundation installer (Cursor flavor) — drop a best-effort port of the
# /dev workflow into a Cursor project.
#
# This is the Cursor-IDE counterpart to install.sh. Because Cursor doesn't have
# Claude Code's Agent / AskUserQuestion / PreToolUse / PostToolUse primitives,
# the port is structural, not behavioral:
#
#   - .claude/rules/*.md         → .cursor/rules/*.mdc   (frontmatter added,
#                                                         alwaysApply: true,
#                                                         paths rewritten)
#   - .claude/skills/**          → .cursor/skills/**     (verbatim copy — they
#                                                         are referenced as
#                                                         docs by the rules)
#   - .claude/agents/*.md        → .cursor/agents/*.md   (role docs; Cursor has
#                                                         no sub-agent dispatch,
#                                                         so these are read by
#                                                         the single agent
#                                                         playing each role in
#                                                         turn)
#   - .claude/orchestrator.md    → .cursor/orchestrator.md (path rewrites + a
#                                                         banner explaining
#                                                         the loss of hooks /
#                                                         sub-agent dispatch)
#   - .claude/commands/dev.md    → .cursor/commands/dev.md (rewritten — no
#                                                         Agent() dispatch
#                                                         shape, single-agent
#                                                         flow)
#   - .workflow/_templates/**    → .workflow/_templates/** (verbatim)
#   - WORKFLOW.md                → WORKFLOW.md           (path rewrites)
#   - CURSOR.md                  → CURSOR.md             (generated stub)
#
# Hooks (.claude/hooks/*.sh) and .claude/settings.json are intentionally NOT
# installed: Cursor has no hook system, so they would be dead code. The
# CURSOR.md stub explains the manual discipline that replaces them.
#
# Usage:
#   ./install-cursor.sh [target-path] [--source <path>] [--force] [--yes] [--dry-run]

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
${SCRIPT_NAME} — install a Cursor port of the /dev workflow into a project

Usage:
  ${SCRIPT_NAME} [target-path] [options]

Arguments:
  target-path        Where to install (default: current directory)

Options:
  --source <path>    Source repo (default: directory containing this script)
  --force, -f        (Currently a no-op — foundation-owned files are always
                     refreshed; reserved for future user-state opt-ins.)
  --yes, -y          Skip the confirmation prompt
  --dry-run          Print the plan, write nothing
  -h, --help         Show this help

What gets installed:
  .cursor/rules/*.mdc          — 7 always-apply rules ported from .claude/rules/
                                 (frontmatter prepended, paths rewritten)
  .cursor/skills/**            — fundamentals skills (verbatim copy, referenced
                                 from the rules)
  .cursor/agents/*.md          — role docs (pm/lead/engineer/qa/retro) the
                                 single Cursor agent reads when it switches
                                 hat per phase
  .cursor/orchestrator.md      — orchestration script rewritten for a single
                                 agent (no Agent() dispatch, no hook guard)
  .cursor/commands/dev.md      — the /dev slash command (Cursor's project
                                 commands feature)
  .workflow/_templates/**      — spec/plan/review/security/tests/recs/retro/epic
                                 + state.json (verbatim)
  .workflow/INDEX.md           — fresh registry (only if missing)
  .workflow/FOLLOWUPS.md       — follow-up registry (only if missing)
  WORKFLOW.md                  — flow reference with paths rewritten for Cursor
  CURSOR.md                    — minimal stub explaining the port (only if missing)

What is intentionally NOT installed:
  .claude/hooks/*.sh           — Cursor has no PreToolUse/PostToolUse hooks
  .claude/settings.json        — Claude-only file
  The .claude/ tree itself     — this is the Cursor flavor; if you want both,
                                 run install.sh too (they don't conflict)

Behavior:
  - Foundation-owned files (rules, skills, agents, commands, orchestrator,
      templates, WORKFLOW.md) are ALWAYS refreshed on every run so upstream
      skill/agent updates land. If you've forked one locally and don't want
      it clobbered, move it out of these paths.
  - .workflow/INDEX.md, .workflow/FOLLOWUPS.md, CURSOR.md: never overwritten
  - Existing .cursor/rules/*.mdc not authored by this installer are left alone
  - Re-running with no source changes is a no-op (idempotent)
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
  ".claude/commands/dev.md" \
  ".claude/skills" \
  ".claude/rules" \
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

# ── Rule descriptions ───────────────────────────────────────────────────────
# Each .mdc gets a `description` slug Cursor shows in the rules panel. Keep
# these one-line so the panel stays readable; the long pitch lives in the rule
# body (and in the skill it points at). Order mirrors the apply order in
# CLAUDE.md (fundamentals → architecture → channels → delivery).
rule_description() {
  case "$1" in
    programming-fundamentals)  echo "Pre-flight fundamentals before writing or changing any non-trivial code (data shape, illegal states, function design, pure core, errors, complexity, naming)." ;;
    database-fundamentals)     echo "Pre-flight fundamentals before any database work (schema, constraints, indexes, query plans, transactions, expand-backfill-contract migrations)." ;;
    hexagonal-backend)         echo "Ports-and-adapters layering for backend code (domain / application / infrastructure; dependencies point inward)." ;;
    architecture-fundamentals) echo "System-level architecture fundamentals (boundaries, ownership, sync vs async, resilience, consistency, observability, contract evolution)." ;;
    queue-fundamentals)        echo "Queue / message-broker fundamentals (delivery semantics, idempotent consumers, ack discipline, retries/DLQ, ordering, outbox)." ;;
    debug-fundamentals)        echo "Debugging fundamentals when a failure's cause is unknown (reproduce, read evidence, facts vs assumptions, bisect, one change at a time, right layer, cause + regression test)." ;;
    git-workflow)              echo "Git workflow fundamentals before writing to .git (fresh base, atomic commits, why-carrying messages, local vs shared history, integrate often, PR as unit of review, recover with reflog)." ;;
    *)                         echo "$1" ;;
  esac
}

# ── Path rewrite filter ─────────────────────────────────────────────────────
# Rewrites .claude/* references in markdown so the ported docs link to the
# .cursor/* tree. Hooks/settings paths become parenthesised notes because they
# don't exist in the Cursor port — leaving the original path would be a lie.
rewrite_paths() {
  sed \
    -e 's|\.claude/rules/|.cursor/rules/|g' \
    -e 's|\.claude/skills/|.cursor/skills/|g' \
    -e 's|\.claude/agents/|.cursor/agents/|g' \
    -e 's|\.claude/commands/|.cursor/commands/|g' \
    -e 's|\.claude/orchestrator\.md|.cursor/orchestrator.md|g'
}

# Converts a Claude rule (.md) into a Cursor rule (.mdc) by prepending
# frontmatter and rewriting paths. Frontmatter uses alwaysApply: true so
# Cursor injects the rule into every conversation, matching the always-on
# semantics of .claude/rules/.
convert_rule_to_mdc() {
  local src="$1" dst="$2" name desc
  name="$(basename "$src" .md)"
  desc="$(rule_description "$name")"
  mkdir -p "$(dirname "$dst")"
  {
    printf -- '---\n'
    printf 'description: %s\n' "$desc"
    printf 'alwaysApply: true\n'
    printf -- '---\n\n'
    rewrite_paths < "$src"
  } > "$dst"
}

# Copies a markdown file with path rewrites applied.
copy_with_rewrite() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  rewrite_paths < "$src" > "$dst"
}

# Verbatim copy (used for workflow templates — Cursor-agnostic markdown).
copy_verbatim() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

# Orchestrator gets the rewrite + a Cursor-port banner prepended. The banner
# tells the reader (a single Cursor agent) how to map the body's Claude Code
# vocabulary (Agent spawns, AskUserQuestion, hooks) onto Cursor primitives.
copy_orchestrator() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  {
    cat <<'BANNER'
> **Cursor-port banner.** The body below was written for Claude Code and still uses its vocabulary. When you read it in Cursor, substitute:
>
> | Claude Code phrase | What you actually do in Cursor |
> |---|---|
> | "Spawn `pm` (or `lead` / `engineer` / `qa` / `retro`)" | Read `.cursor/agents/<role>.md` and act as that role for the duration of that phase. No tool call. |
> | "Pass via the `Agent` tool with `subagent_type=…`" | Switch hat in-place. The role doc is your instructions; the surrounding chat is your "spawn prompt." |
> | "Call `AskUserQuestion`" | Ask the question in chat (batched, ≤ 4 per round). |
> | "`PreToolUse` / `PostToolUse` hook" | No-op in Cursor — the discipline is on you. In particular, **write `state.json` after every step yourself**; there is no guard hook to remind you. |
> | "`general-purpose` sub-agent fallback" | N/A — you are the only agent. |
>
> Path references to `.claude/hooks/*.sh`, `.claude/settings.json`, and `~/.claude/projects/.../memory/MEMORY.md` are Claude Code-only artifacts. Treat sentences mentioning them as historical context, not active behavior.

---

BANNER
    rewrite_paths < "$src"
  } > "$dst"
}

# ── Build the plan ──────────────────────────────────────────────────────────
# Each plan row carries: src-relative-path | dst-relative-path | mode | action
#   mode   = skip-if-exists | always-overwrite | never-overwrite
#   action = convert-rule | rewrite | verbatim
#
# Rules and skills live under directories that we expand into per-file rows.
RULE_FILES=()
while IFS= read -r -d '' f; do
  RULE_FILES+=("${f#"$SOURCE_PATH"/}")
done < <(find "$SOURCE_PATH/.claude/rules" -type f -name '*.md' -print0 | LC_ALL=C sort -z)

SKILL_FILES=()
while IFS= read -r -d '' f; do
  SKILL_FILES+=("${f#"$SOURCE_PATH"/}")
done < <(find "$SOURCE_PATH/.claude/skills" -type f -print0 | LC_ALL=C sort -z)

AGENT_FILES=()
while IFS= read -r -d '' f; do
  AGENT_FILES+=("${f#"$SOURCE_PATH"/}")
done < <(find "$SOURCE_PATH/.claude/agents" -type f -name '*.md' -print0 | LC_ALL=C sort -z)

TEMPLATE_FILES=()
while IFS= read -r -d '' f; do
  TEMPLATE_FILES+=("${f#"$SOURCE_PATH"/}")
done < <(find "$SOURCE_PATH/.workflow/_templates" -type f -print0 | LC_ALL=C sort -z)

PLAN=()

# Rules: .claude/rules/foo.md → .cursor/rules/foo.mdc (with frontmatter + path rewrites)
for rel in "${RULE_FILES[@]}"; do
  base="$(basename "$rel" .md)"
  PLAN+=(".claude/rules/${base}.md|.cursor/rules/${base}.mdc|always-overwrite|convert-rule")
done

# Skills: copy with path rewrites under .cursor/skills/. Skill bodies link
# *out* to .claude/rules/<name>.md in their "always-on" tail paragraph; those
# need rewriting. Internal cross-links between a skill's SKILL.md and its
# references/*.md are relative paths the sed pattern doesn't touch.
for rel in "${SKILL_FILES[@]}"; do
  dst_rel="${rel#.claude/}"
  PLAN+=("${rel}|.cursor/${dst_rel}|always-overwrite|rewrite")
done

# Agents: copy with path rewrites under .cursor/agents/
for rel in "${AGENT_FILES[@]}"; do
  dst_rel="${rel#.claude/}"
  PLAN+=("${rel}|.cursor/${dst_rel}|always-overwrite|rewrite")
done

# Orchestrator: copy with path rewrites + a Cursor-port banner explaining that
# the body's references to Agent() dispatch and PreToolUse/PostToolUse hooks
# don't literally apply in Cursor. The reader (a single Cursor agent playing
# all roles) substitutes "spawn pm" with "switch hat to pm and follow
# .cursor/agents/pm.md", and "hook-enforced state.json" with "self-enforced
# state.json discipline."
PLAN+=(".claude/orchestrator.md|.cursor/orchestrator.md|always-overwrite|rewrite-orchestrator")

# /dev command: this one we hand-write at apply time (it's a substantive
# rewrite, not a path-rewritten copy), so a sentinel action "synthesize-dev"
# stands in for the src column.
PLAN+=("synthesize-dev|.cursor/commands/dev.md|always-overwrite|synthesize-dev")

# Templates: verbatim
for rel in "${TEMPLATE_FILES[@]}"; do
  PLAN+=("${rel}|${rel}|always-overwrite|verbatim")
done

# Registries and CURSOR.md: never overwrite user state
PLAN+=(".workflow/INDEX.md|.workflow/INDEX.md|never-overwrite|verbatim")
PLAN+=(".workflow/FOLLOWUPS.md|.workflow/FOLLOWUPS.md|never-overwrite|verbatim")

# WORKFLOW.md: copy with rewrites
PLAN+=("WORKFLOW.md|WORKFLOW.md|always-overwrite|rewrite")

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

# ── Print plan ──────────────────────────────────────────────────────────────
info "Plan"
NEW=0; OVR=0; SKP=0
for row in "${PLAN[@]}"; do
  IFS='|' read -r src_rel dst_rel mode action <<<"$row"
  dst="$TARGET_PATH/$dst_rel"
  if [ "$action" != "synthesize-dev" ] && [ ! -e "$SOURCE_PATH/$src_rel" ]; then
    printf "  ${D}? %s — missing in source${N}\n" "$src_rel"
    continue
  fi
  act="$(resolve_action "$mode" "$dst")"
  case "$act" in
    copy)      printf "  ${G}+${N} %s\n" "$dst_rel"; NEW=$((NEW+1)) ;;
    overwrite) printf "  ${Y}~${N} %s ${D}(overwrite)${N}\n" "$dst_rel"; OVR=$((OVR+1)) ;;
    skip)      printf "  ${D}=${N} %s ${D}(kept)${N}\n" "$dst_rel"; SKP=$((SKP+1)) ;;
  esac
done
printf "\n  Summary: ${G}%d new${N}, ${Y}%d overwrite${N}, ${D}%d kept${N}\n" "$NEW" "$OVR" "$SKP"

# CURSOR.md stub (separate from PLAN — generated, not copied)
CURSOR_DST="$TARGET_PATH/CURSOR.md"
if [ -e "$CURSOR_DST" ]; then
  printf "  ${D}=${N} CURSOR.md ${D}(kept)${N}\n"
else
  printf "  ${G}+${N} CURSOR.md ${D}(stub — explains the Cursor port)${N}\n"
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

# Inline content for .cursor/commands/dev.md. Kept as a heredoc so it lives
# next to the install logic — there is no canonical Claude file to copy from
# (the Claude /dev command is built around Agent() sub-agent dispatch that
# Cursor cannot do).
write_cursor_dev_command() {
  local dst="$1"
  mkdir -p "$(dirname "$dst")"
  cat > "$dst" <<'CURSOR_DEV_EOF'
---
description: Run the /dev workflow on this intent (spec → plan → gate → implement → review → security → test → docs → ship → retro). Pass --resume <id> to continue an interrupted run.
---

Run the `/dev` workflow on this intent: **$ARGUMENTS**

> **Cursor port note.** This workflow was designed around Claude Code's sub-agent dispatch (`Agent(subagent_type=…)`) and PreToolUse/PostToolUse hooks. Cursor has neither, so the port collapses the multi-agent flow into a single agent (you) that plays each role in turn by reading the corresponding `.cursor/agents/<role>.md` file before that phase. There is no hook-enforced state.json discipline — keeping `state.json` in sync after every step is on you. Treat that file as the source of truth for `/dev --resume <id>`.

1. Read `.cursor/orchestrator.md` end-to-end. It is the source of truth for the flow — phases, state discipline, cycle limits, and the rules for switching between roles.
2. Read `WORKFLOW.md` for the type-aware phase matrix and the example runs.
3. Follow `.cursor/orchestrator.md` as if its instructions were addressed to you. In particular:
   - Run the Phase 1 interview yourself by asking the user 3–4 focused questions in chat (one batch). Do not invent answers for slots the user did not give.
   - Handle the gate, all cycle-limit escalations, and the skill-candidate approval by asking the user in chat.
   - For each phase that delegates work in the Claude version (pm / lead / engineer / qa / retro), **read the matching `.cursor/agents/<role>.md`** and act as that role for the duration of that phase. Switch hat between phases — the role docs encode each phase's required inputs, output contract, and acceptance checks.
   - Write `state.json` (Write/Edit) after **every** step. There is no hook to remind you; if you forget, `/dev --resume` will be wrong.

Behavior:
- If `$ARGUMENTS` is empty, ask the user for the intent in chat before proceeding.
- If `$ARGUMENTS` starts with `--resume`, read `.workflow/<id>/state.json` and continue from the recorded step instead of starting fresh. If `state.json` is missing or malformed, ask the user whether to start fresh.

Reference: `WORKFLOW.md` for the full flow definition, `.cursor/orchestrator.md` for the step-by-step orchestration script.
CURSOR_DEV_EOF
}

REMOVED=0
for row in "${PLAN[@]}"; do
  IFS='|' read -r src_rel dst_rel mode action <<<"$row"
  dst="$TARGET_PATH/$dst_rel"
  src="$SOURCE_PATH/$src_rel"

  if [ "$action" != "synthesize-dev" ] && [ ! -e "$src" ]; then
    continue
  fi

  act="$(resolve_action "$mode" "$dst")"
  case "$act" in
    skip) continue ;;
  esac

  case "$action" in
    convert-rule)         convert_rule_to_mdc      "$src" "$dst" ;;
    rewrite)              copy_with_rewrite        "$src" "$dst" ;;
    rewrite-orchestrator) copy_orchestrator        "$src" "$dst" ;;
    verbatim)             copy_verbatim            "$src" "$dst" ;;
    synthesize-dev)       write_cursor_dev_command "$dst" ;;
    *) warn "unknown action '$action' for $dst_rel; skipping" ;;
  esac
done

# CURSOR.md stub. Parallel to the CLAUDE.md stub install.sh writes, but
# Cursor-flavored: explains the port boundary so a new contributor doesn't
# expect Agent() dispatch or hook-enforced state writes to work.
if [ ! -e "$CURSOR_DST" ]; then
  cat > "$CURSOR_DST" <<'EOF'
# CURSOR.md

Project uses a Cursor port of the claude-foundation `/dev` workflow.

Entry point: `/dev <intent>` (or `/dev --resume <id>`) — spec → plan → gate → implement → review → (security) → test → docs → ship → retro.

The flow is type-aware: `feat` / `fix` / `refactor` / `chore` / `docs` / `spike` each skip or specialise some phases (e.g., `fix` writes its regression test before the fix; `chore` skips QA; `spike` produces `recommendations.md` instead of code).

## What's different from the Claude Code original

The original workflow assumed Claude Code primitives Cursor doesn't have. The port collapses those:

| Claude Code primitive | Cursor substitute |
|---|---|
| `Agent(subagent_type="engineer")` etc. | The single Cursor agent reads `.cursor/agents/<role>.md` and plays that role for the phase. No spawn — just a hat-switch. |
| `AskUserQuestion` (structured prompts) | Plain chat questions. Keep them batched (one round of 3–4 questions per gate). |
| PreToolUse / PostToolUse hooks | Manual discipline. Lint after edits manually (`bash <repo lint command>`); update `.workflow/<id>/state.json` after every step yourself. |
| Hook-enforced state.json writes | Self-enforced. If `/dev --resume` lands on stale state, that's the bug. |

## Files

- `.cursor/rules/*.mdc` — always-apply rules (fundamentals + git workflow). Cursor loads these automatically.
- `.cursor/skills/**` — deep-dive skill content the rules point to.
- `.cursor/agents/*.md` — role docs (pm/lead/engineer/qa/retro). Read these when entering the matching phase.
- `.cursor/orchestrator.md` — the orchestration script the `/dev` command follows.
- `.cursor/commands/dev.md` — the slash command itself.
- `.workflow/<id>/` — run artifacts (spec/plan/review/security/tests/recs/retro + `state.json`).
- `.workflow/INDEX.md`, `.workflow/FOLLOWUPS.md` — cross-run state.
- `WORKFLOW.md` — full flow reference.

If you're also running Claude Code on this repo, run `install.sh` alongside this one — the `.claude/` and `.cursor/` trees don't conflict, and the `.workflow/` tree is shared.
EOF
fi

ok "files written"

# ── Summary ─────────────────────────────────────────────────────────────────
printf "\n${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
printf "${G}✓ claude-foundation (Cursor flavor) installed${N} at %s\n" "$TARGET_PATH"
printf "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
cat <<EOF

  Files     : ${NEW} new, ${OVR} overwritten, ${SKP} kept

  Next steps:
    1. Open the project in Cursor
    2. In a new chat, run:  /dev <intent>
    3. Read CURSOR.md for the manual-discipline notes that replace hooks
    4. Read WORKFLOW.md for the full flow definition

  ${Y}Caveats vs the Claude Code version${N}:
    - No sub-agent dispatch (.cursor/agents/* are role docs you read in-place)
    - No PreToolUse/PostToolUse hooks (lint + state.json discipline is manual)
    - No structured AskUserQuestion (gates are plain chat questions)
EOF
