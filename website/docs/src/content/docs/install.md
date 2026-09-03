---
title: Install
description: Requirements and the two supported ways to install Change Loop into an existing repository.
---

Install the `claude-foundation` CLI once on your machine, then initialize Change
Loop in each project. Running `init` again upgrades the managed files. It is
safe for brownfield repositories: it seeds what is missing, refreshes what it
owns, and leaves project-owned files alone.

## Requirements and recommended tools

| Tool | Status | Why |
|---|---|---|
| **Node.js 20.19 or later** | Required | The runtime is plain ESM Node with no compile step |
| **OpenSpec CLI 1.7.0** | Required | Spec synchronization and archive |
| **Git** | Recommended | Enables worktree isolation; a dirty or non-Git project falls back to an isolated copy |

```bash
npm install -g @fission-ai/openspec@1.7.0
```

`jq` is recommended for merging hooks into an existing
`.claude/settings.json`. Without it, installation continues, preserves the
existing file, and writes `.claude/settings.foundation.json` for manual review.

## Install from source

```bash
git clone https://github.com/Maximumsoft-Co-LTD/claude-foundation.git
cd claude-foundation
./install.sh /path/to/your-project
```

## Install with Homebrew

```bash
brew tap maximumsoft-co-ltd/claude-foundation \
  https://github.com/Maximumsoft-Co-LTD/claude-foundation
brew install claude-foundation
claude-foundation init /path/to/your-project --yes
```

`claude-foundation init` is the same installer; `--yes` skips the confirmation prompt.
Later upgrades use `brew upgrade claude-foundation`, followed by `init` for each
project you want to refresh.

:::tip
Open a **new** agent session in the target project after installing, so the slash commands are registered.
:::

## Other agent hosts

Claude Code needs no adapter. For other hosts, `--host` layers one over the same shared install:

```bash
claude-foundation init /path/to/your-project --host cursor    # or opencode, codex
```

| Host | What the adapter adds |
|---|---|
| **Cursor** | Six primary lifecycle prompts plus `/changes` and the `/feature` compatibility alias in `.cursor/commands/`, and the always-on skill router as a `.mdc` rule with `alwaysApply: true` |
| **OpenCode** | The same six primary prompts plus two utility/alias prompts in `.opencode/commands/`, and a guard plugin at `.opencode/plugins/foundation.js` that replays the shipped hooks — the secrets and phase-mutation guards block live, lint feeds back on edit. Skills and the agent contract need no adapter: OpenCode reads `.claude/skills/` and `AGENTS.md` natively |
| **Codex CLI** | The eight prompts in `$CODEX_HOME/prompts` (Codex has no per-project prompt directory), stamped with an ownership marker so re-installs refresh Change Loop prompts without clobbering a same-named user prompt |

:::caution[Codex has no tool hooks]
Codex cannot run live guards, so the secrets and phase-mutation hooks are inert there. Land gates and the opt-in `no-direct-main-commit.sh` remain the enforcement.
:::

## Verify

```bash
claude-foundation version
claude-foundation doctor --stage change
```

`doctor` is the readiness check you should reach for whenever something looks wrong. It diagnoses project, provider, and lifecycle state, and it reports unresolved apply transactions before Land ever reaches them.

## Commit the installation

In a Git project, the installer stages the managed setup files but does not
commit them. Review and commit that setup before the first change:

```bash
git status
git commit -m "chore: install Change Loop"
```

This needs your explicit approval. If the files remain uncommitted, Change Loop
correctly treats them as part of the next change surface, which makes the first
change larger and forces copied-workspace isolation.

## Start your first change

Open a new agent session in the initialized project and describe the outcome:

```text
/change allow account owners to edit their display name
```

Review the proposed agreement, then continue with `/build`, `/prove`, and
explicit `/land`. The agent runs the underlying CLI and recovery commands. See
the [Quickstart](/docs/quickstart/) for the complete user journey.

## What the installer owns

This boundary matters, because upgrades act on it. Change Loop-managed paths are **copied on every install** and recorded in `.foundation/install-manifest.txt`:

```text
.claude/orchestrator.md
.claude/commands
.claude/harness
.claude/skills
.claude/rules
.claude/hooks
openspec/schemas
.foundation/.gitignore
.foundation/README.md
WORKFLOW.md
```

Project-owned paths are seeded or merged but **never clobbered**:

```text
.claude/settings.json          # hooks merged with jq; timestamped backup
openspec/config.yaml           # copied only when missing
openspec/repositories.yaml     # copied only when missing
foundation.json                # copied when missing
CLAUDE.md / AGENTS.md          # only the marked pointer block is rewritten
```

Your specs, active changes, runtime state, custom agents, and hooks survive every upgrade. A path dropped from the managed list is removed from your project only if the manifest previously claimed it — so Change Loop never deletes a file it did not install.

Because `foundation.json` belongs to your project, an upgrade does not replace
its budgets or review policy with newer defaults. Read
[Configure foundation.json](/docs/foundation-config/) before changing it.

## Browser proof stays yours

Change Loop does not install test frameworks, browsers, or project dependencies. If a claim needs browser evidence, install and lock `@playwright/test` and its browser binaries **in your application**. Change Loop validates and executes the local tool; it will never download an unpinned browser framework during proof.

The same rule applies everywhere: every executable named by an adapter is owned and version-locked by your repository, not by the harness.
