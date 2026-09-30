---
description: Compose change → build → prove → land.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

Run **$ARGUMENTS** exactly as the separate commands, reading each file once:

1. `.claude/commands/change.md`
2. `.claude/commands/build.md`
3. `.claude/commands/prove.md`
4. `.claude/commands/land.md`, only with Land authority.

Do not stop between phases except at a user gate or a real boundary. Without
Land authority, stop at `proven`; with it, success is `archived`.

`--resume <change>`: continue from its current phase; `advance` skips
completed Build work and reuses fresh evidence.
`--plan-only`: run Change only.

Do not reread framework files.
