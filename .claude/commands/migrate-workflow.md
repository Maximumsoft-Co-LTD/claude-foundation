---
description: Migrate legacy .workflow records into OpenSpec without treating narrative as truth.
argument-hint: [legacy-run-id] [--apply]
---

Run `node .claude/harness/foundation.mjs migrate $ARGUMENTS`.

Default to dry-run. Move only behavior corroborated by code, tests, or an
accepted contract. Stable facts may become OpenSpec context; unresolved valid
work becomes a new change. Preserve legacy directories read-only and skip
speculation, runtime chatter, obsolete tasks, and duplicates.
