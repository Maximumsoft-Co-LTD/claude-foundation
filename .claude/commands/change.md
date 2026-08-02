---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

When `--prototype-selection` is supplied, require a regular
`.foundation/prototypes/<id>/selection.md`; never discover the latest prototype.
Treat it as non-authoritative input; summarize its decision/reasons
in proposal/design. Never use it or its artifacts as evidence.

Run `claude-foundation doctor --stage change`; reuse the named change or
`claude-foundation runtime new`. Resolve ambiguity, impact, coupling, security,
evidence, and size. Use only providers justified by observable claims.

Complete proposal, delta specs, design, stable-ID `tasks.md`,
`evidence.yaml`, execution wiring, and repository scope. Never guess commands.

Run `claude-foundation validate` and
`claude-foundation doctor --stage build --change <change>`. If a sandbox exists,
use `claude-foundation sandbox sync`.

Ask only agreement-changing decisions. Do not implement.
