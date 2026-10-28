---
name: skill-suite-auditor
description: "Use when auditing the skill catalog for metadata, overlap, broken references, or ownership conflicts. Skip behavioral evaluation (skill-evaluation)."
---

# Skill suite auditor

An empty static report does not establish behavioral correctness.

## Steps

1. Pin the catalog, version, and audit scope. Preserve dirty work and custom
   consumer skills. Inventory entry points and dependencies.
2. Run `node .claude/skills/skill-suite-auditor/scripts/audit.mjs .claude/skills`;
   its JSON reports static metadata and reference coverage only.
3. Read descriptions and bodies for competing triggers, missing task owners,
   undeclared tools, and instructions that conflict with lifecycle, workspace,
   evidence, authority, or recovery contracts.
4. Prioritize defects by concrete failure. Recommend merge, revise, reference,
   or new skill with a positive/negative trigger and an acceptance check.
5. Report audited coverage, source paths, findings, and unknowns.

## Harness

Store durable implementation choices in OpenSpec, not another ledger. Do not
import routing hooks, fabricate receipts, or grant external authority.

## References

- `references/pstack-adoption.md` — disposition of pstack-derived procedures.
- Use `skill-evaluation` for live comparisons and `skill-creator` for approved edits.
