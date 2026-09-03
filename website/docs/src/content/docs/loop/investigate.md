---
title: /investigate
description: Optional read-only exploration for when the problem, cause, or direction is genuinely unclear.
---

```text
/investigate <problem or decision> [--compare]
```

**Use this only when you do not yet know enough to write a reliable change agreement.** It is the one optional step in the loop, and reaching for it by reflex just adds latency.

Typical reasons to use it:

- an unknown root cause
- several approaches with materially different tradeoffs
- unclear compatibility or migration constraints
- an unfamiliar brownfield code path
- an external API whose versioned documentation, success path, or failure
  behavior has not been read yet

## Start from the uncertainty

Phrase the input as the decision you cannot make, not as a request to implement something:

```text
/investigate why profile updates occasionally overwrite newer data
```

For an existing change, include its ID and the new question:

```text
/investigate add-profile: should updates use last-write-wins or optimistic locking?
```

## What it produces

The agent reads the relevant code and separates its output into:

- **verified, code-grounded facts**
- **hypotheses** that are not yet proven
- **constraints** and affected boundaries
- **options** with tradeoffs
- **unknowns** that still require a decision from you

That separation is the whole value. A finding presented as a fact and a finding presented as a hunch lead to very different changes, and collapsing them is how bad agreements get written.

It ends with exactly one of:

```text
ready for /change
needs user decision
not worth changing
```

`not worth changing` is a legitimate, useful outcome.

## What it may write

Investigation is read-only with respect to product code and OpenSpec. Its only permitted write is an investigation note at `openspec/investigations/<name>.md`, and only when the findings need to persist.

## Comparison mode

For genuinely unresolved experience, API, or architecture alternatives, add `--compare`:

```text
/investigate dashboard filter interaction --compare
```

This produces 3–5 lightweight, disposable alternatives under `.foundation/prototypes/<id>/`. In this mode the agent writes **only** inside that prototype directory — never product code, never OpenSpec, and it adds no lifecycle state.

It always writes `selection.md` recording the choice, the reasons, the rejected alternatives, and the artifact paths. When the evidence cannot decide, it asks you rather than picking.

:::caution[Prototypes are not evidence]
Files under `.foundation/prototypes/` are non-authoritative by design. The runtime rejects them — including local-path references and symlinked origins — before copying any artifact or writing a receipt. A prototype can inform a decision; it can never prove a claim.
:::

Continue into the agreement with the selection attached:

```text
/change <intent> --prototype-selection <selection-path>
```

`/change` summarizes that decision into the proposal and design. It does not treat the selection or its artifacts as evidence.
For an integration, the investigation note records the exact documentation
source and version. `/change` then requires linked success and failure scenarios;
an unread or unversioned API is a research boundary, never a guessed contract.
