---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent> | <existing-change>
---

Create or update **$ARGUMENTS**.

Run `claude-foundation doctor --stage change`; reuse the named change or
`claude-foundation runtime new`. Resolve
ambiguity, impact, coupling, security triggers, evidence, and size. Use only
providers justified by observable claims.

Complete the selected schema: proposal, delta specs, load-bearing design,
stable-ID `tasks.md`, claims in `evidence.yaml`, execution wiring, and repository
scope. Never guess or install project commands.

Run `claude-foundation validate` and
`claude-foundation doctor --stage build --change <change>`. If a sandbox exists,
use `claude-foundation sandbox sync`.

Ask only for decisions that change the agreement. Do not implement.
