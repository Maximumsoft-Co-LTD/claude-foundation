---
description: Create or complete an OpenSpec change and its evidence contract.
argument-hint: <intent> | <existing-change>
---

Create or update the change for **$ARGUMENTS**.

Read [the change loop](../orchestrator.md), then:

1. Reuse the named active change or run
   `node .claude/harness/foundation.mjs new "<intent>"`.
2. Resolve ambiguity, impact, coupling, semantic security triggers, and evidence.
3. Use the selected OpenSpec schema to complete proposal, delta specs, design
   when needed, and `tasks.md`.
4. Write claims to `evidence.yaml`; every observable acceptance scenario has a
   stable claim ID and one or more provider capabilities.
5. Run `node .claude/harness/foundation.mjs validate <change>`.

Ask only for a decision that materially changes the agreement. Do not implement.
