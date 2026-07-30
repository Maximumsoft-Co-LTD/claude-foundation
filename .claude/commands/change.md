---
description: Create or complete an OpenSpec change and its evidence contract.
argument-hint: <intent> | <existing-change>
---

Create or update the change for **$ARGUMENTS**.

The managed Foundation block already supplies the loop invariants; do not reload
the full orchestrator. Then:

1. Run `claude-foundation doctor --stage change`. Surface warnings now; if this delivery is
   expected to land in the same run, use `--require-archive`.
2. Reuse the named active change or run
   `claude-foundation runtime new "<intent>"`.
3. Resolve ambiguity, impact, coupling, semantic security triggers, and evidence.
   Use `claude-foundation providers` when choosing capabilities.
   Select only providers needed by an observable claim; do not run the full
   catalog by default.
4. Use the selected OpenSpec schema to complete proposal, delta specs, design
   when needed, and `tasks.md`.
5. Write stable claims to `evidence.yaml` and executable provider wiring to
   `execution.yaml`. Every observable acceptance scenario has a stable claim ID
   and one or more provider capabilities. Test discovery is implicit for `test`.
   Never guess or auto-install a project command.
6. Run `claude-foundation validate <change>`.
7. Run `claude-foundation doctor --stage build --change <change>`. Commands that
   Build will create may remain planned; topology and policy warnings may not.
8. If `.foundation/runtime/<change>.json` names an active `worktree` or `copy`
   workspace, run `claude-foundation sandbox sync <change>`.
   This preserves only unchanged completed task lines, updates the sandbox
   change packet, and invalidates prior proof.

Ask only for a decision that materially changes the agreement. Do not implement.
