---
name: claude-md
description: "Use when asked to create or update a repository's CLAUDE.md. Skip human onboarding docs (use init-project-docs)."
---

# Revise CLAUDE.md

Keep the always-loaded guide short, source-grounded, and current; link canonical
docs instead of copying them.

## Steps

1. Read `references/guide-workflow.md` for the nine-section shape and the
   preservation rules.
2. Inspect real manifests, entry points, commands, and docs. Never infer shipped
   status from a commit or roadmap entry.
3. Preserve hand-authored house rules and exact user wording where scope or
   authority depends on it.
4. Keep human intent, durable instructions, and factual project context distinct
   from agent summaries; label missing evidence.
5. Link to canonical documentation; do not duplicate it or add transient status.

## Harness

This guide is product documentation, not a task ledger or proof store. Within an
active change, edit only returned paths and resume the harness action.

## References

- `references/guide-workflow.md` — section shape and preservation rules; read
  before editing.
- Use `init-project-docs` for deep human-facing onboarding docs.
