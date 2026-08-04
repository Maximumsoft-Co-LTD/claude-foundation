---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

With `--prototype-selection`, require the selection file; summarize it but never
use it as evidence.

Run `doctor --stage change`; reuse the change. Otherwise classify before creating it:
use `change new <intent> --rapid` only for low-impact, isolated, unit/static
work; use standard otherwise. Resolve impact, coupling, security, and evidence.
Omit `--security` when there are no triggers. Require review only for policy triggers.

Complete artifacts, tasks, evidence, and execution.

Run `change validate` then `doctor --stage build --change <change>`. Sync any sandbox.

Ask material decisions in the user's language. Classify subjective acceptance
as required or not required—never infer it from silence or expose harness fields.
