# Team agents — manifest

Local fanout workers under `.claude/agents/` for the `/dev` fanout pattern (see `.claude/skills/fanout-team-agents/SKILL.md`). Some are foundation-native spec/plan workers; the review workers are local forks of upstream review agents. This file is the audit trail: source path per agent, fork date when applicable, fork-time version, and the drift-awareness rule.

## Naming convention

Every embedded review agent uses the filename prefix `team-<role>.md`, and the `name:` YAML field is renamed in lock-step to match the filename slug (e.g., file `team-code-reviewer.md` ↔ `name: team-code-reviewer`). Three reasons:

1. **No shadowing of the 5 `/dev` workers** (`pm`, `lead`, `engineer`, `qa`, `retro`). The `team-` prefix gives visual separation so a reader of `lead.md`'s review mode cannot mistake `team-code-reviewer` for `lead` itself — `lead` remains the synthesiser/owner of `review.md`; the embedded `code-reviewer` is one of the fanned-out workers.
2. **Filename ↔ `name:` lock-step is load-bearing.** Claude Code's sub-agent spawn surface uses the `name:` YAML field; if the filename and `name:` drift the agent cannot be spawned. The rename verify-clause in plan steps 4–9 enforces this.
3. **Flat directory layout** under `.claude/agents/`. Subfolder support is undocumented in Claude Code — every observed marketplace plugin keeps agents flat. The `team-` prefix achieves visual grouping without depending on subfolder discovery.

## Foundation-native workers

- team-codebase-explorer — read-only worker for spec/plan codebase exploration.
- team-best-practice-researcher — research worker for spec/plan best-practice probes.

These are foundation-native because the existing review-agent forks are diff-oriented; spec/plan needs pre-diff exploration and research workers with read-only output contracts.

## Direct-nesting (`Agent`) grants

Since Claude Code v2.1.172 a worker with `Agent` in its `tools` can spawn nested helpers. The tool grant is capability, not permission: a worker may use it only when its parent prompt includes `fanout_authorized: true`, a named spawn proof, and disjoint child scopes. Size or the word “large” never authorizes nesting. Three workers hold `Agent` for those explicitly authorized cases:

- `team-codebase-explorer` — splits a large area into sub-areas → sub-explorers.
- `team-best-practice-researcher` — splits a multi-part question into sub-questions → sub-researchers.
- `team-code-reviewer` — splits a large diff into per-area slices → sub-reviewers.

The other review workers (`team-pr-test-analyzer`, `team-silent-failure-hunter`, `team-type-design-analyzer`) stay read-only with **no `Agent`**. Each `Agent`-holder caps authorized fanout and stamps every helper prompt with a no-further-spawn line, so nesting is one level deep only.

The team-mode command worker **`uxui`** also holds `Agent` and follows the same authorization and one-level-deep rules. Explicit `/uxui-plan` authorizes the UX worker itself, not nested research.

## Fork sources

Forked: **2026-05-21**. Source plugin: **`pr-review-toolkit`** at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/pr-review-toolkit/agents/`. Version inferred from the marketplace cache at fork-time (not pinned to a release tag — `pr-review-toolkit` did not carry a version manifest in the cache snapshot).

- team-code-reviewer — `pr-review-toolkit/agents/code-reviewer.md` → `.claude/agents/team-code-reviewer.md`
- team-code-simplifier — `pr-review-toolkit/agents/code-simplifier.md` → RETIRED 2026-07-15 (folded into `team-code-reviewer` as the Simplification lens)
- team-comment-analyzer — `pr-review-toolkit/agents/comment-analyzer.md` → RETIRED 2026-07-15 (folded into `team-code-reviewer` as the Comment Accuracy lens)
- team-pr-test-analyzer — `pr-review-toolkit/agents/pr-test-analyzer.md` → `.claude/agents/team-pr-test-analyzer.md`
- team-silent-failure-hunter — `pr-review-toolkit/agents/silent-failure-hunter.md` → `.claude/agents/team-silent-failure-hunter.md`
- team-type-design-analyzer — `pr-review-toolkit/agents/type-design-analyzer.md` → `.claude/agents/team-type-design-analyzer.md`
- team-dispatching-skill-source — `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/dispatching-parallel-agents/SKILL.md` (pattern source for `.claude/skills/fanout-team-agents/SKILL.md` only; no agent fork from `superpowers` ships — Open question E of spec 0002 resolved in favor of `pr-review-toolkit`'s `code-reviewer` and dropped the `superpowers` variant to avoid two competing reviewers)

Fork date: 2026-05-21

## Local edits (post-fork)

- **2026-07-09** — added `LSP` to `team-code-reviewer`, `team-silent-failure-hunter`, `team-type-design-analyzer` (read-only: go-to-def / find-references for cross-diff verification). Does **not** touch the `Agent`/`Write`/`Bash` boundaries — these workers stay report-only and, except `team-code-reviewer`, still hold no `Agent`.
- **2026-07-15 (b)** — `team-code-simplifier` + `team-comment-analyzer` RETIRED: their checklists folded into `team-code-reviewer` as the Simplification and Comment Accuracy lenses. Rationale: heavy scope overlap with the reviewer, lowest marginal signal of the six, and two fewer spawns/synthesis inputs per L review. Review tiers are now core-3 / full-4.
- **2026-07-15** — `team-code-reviewer` scoring contract changed: report ALL findings with confidence + severity (was: pre-filter to ≥ 80). The ≥ 80 precision gate moved to `lead`'s synthesis (`references/lead.md > Review fanout`), where cross-worker context lives. Rationale: pre-filtering in the worker suppresses recall irrecoverably; current-generation models over-obey "don't be nitpicky" and drop true positives.
- **2026-07-30** — direct nesting now requires parent-supplied `fanout_authorized: true`, a named spawn proof, and disjoint child scopes. Size alone no longer authorizes worker-created processes.

## Drift awareness

Upstream parity is **not** enforced for forked agents. Drift is expected — the local forks are owned by this repo and pick up local conventions (this repo's `CLAUDE.md` rules, logging functions, test framework). Foundation-native workers (`team-codebase-explorer`, `team-best-practice-researcher`) have no upstream-parity obligation. The rules:

- Any change to a `team-*` agent file must update the corresponding `Fork source:` block (top of the file, under the YAML) — at minimum, set a new `forked:` date or add a `local-edit:` line citing what changed.
- **DETACHED (decided 2026-07-15):** the forks are permanently detached from `pr-review-toolkit` — no upstream audit is planned or owed. The forks evolve with this repo's review pipeline only; anyone wanting upstream behaviour should install the plugin, not these files. (The fork-date stamp above remains the reference point for archaeology.)
