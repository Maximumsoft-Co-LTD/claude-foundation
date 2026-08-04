---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

With `--prototype-selection`, require the exact regular selection file. Treat it
as non-authoritative; summarize its decision/reasons, never use it as evidence.

Run `doctor --stage change`; reuse the change. Otherwise classify before creating it:
use `change new <intent> --rapid` only for
low-impact, isolated, unit/static work; use standard otherwise. Resolve
ambiguity, impact, coupling, security, evidence, and size.
Omit `--security` when there are no triggers. Require review only for policy triggers.

Complete artifacts, stable-ID tasks, evidence, execution, and repository scope.
Run `providers` once for justified wiring.

Run `change validate` then `doctor --stage build --change <change>`. Sync any sandbox.

Ask material decisions; never implement.
