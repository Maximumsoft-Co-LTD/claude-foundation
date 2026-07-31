---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Start from `claude-foundation packet <change> --phase prove`, not Build history.
Run:

```text
claude-foundation doctor --stage prove --change <change>
claude-foundation proof preflight <change>
claude-foundation proof plan <change>
claude-foundation proof execute <change>
claude-foundation proof audit <change>
```

Obtain only missing external receipts, then execute again. Run required
independent review. Never claim a pass without its valid receipt, and do not
Land.
