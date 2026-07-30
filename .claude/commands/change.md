---
description: Create or complete an OpenSpec change and its evidence contract.
argument-hint: <intent> | <existing-change>
---

Create or update the change for **$ARGUMENTS**.

Read [the change loop](../orchestrator.md), then:

1. Run `claude-foundation doctor`. Surface warnings now; if this delivery is
   expected to land in the same run, use `--require-archive`.
2. Reuse the named active change or run
   `claude-foundation runtime new "<intent>"`.
3. Resolve ambiguity, impact, coupling, semantic security triggers, and evidence.
   Use `claude-foundation providers` when choosing capabilities.
   Select only providers needed by an observable claim; do not run the full
   catalog by default.
4. Use the selected OpenSpec schema to complete proposal, delta specs, design
   when needed, and `tasks.md`.
5. Write claims to `evidence.yaml`; every observable acceptance scenario has a
   stable claim ID and one or more provider capabilities.
6. Run `claude-foundation validate <change>`.
7. If `.foundation/runtime/<change>.json` names an active `worktree` or `copy`
   workspace, run `claude-foundation sandbox sync <change>`.
   This preserves only unchanged completed task lines, updates the sandbox
   change packet, and invalidates prior proof.

Ask only for a decision that materially changes the agreement. Do not implement.
