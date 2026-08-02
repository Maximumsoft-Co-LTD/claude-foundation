---
description: Compare lightweight alternatives before committing to a change.
argument-hint: <problem or decision>
---

Prototype **$ARGUMENTS** only when the user requests it or accepts an agent
recommendation prompted by unresolved alternatives. It is optional, not a phase.

Produce 3–5 alternatives in one request. Make only throwaway comparison artifacts.
Write exclusively under `.foundation/prototypes/<id>/`; never edit product code,
OpenSpec artifacts, or other repository paths.

Ask the user to select when evidence cannot decide. After either an evidence- or
user-determined choice, always write `selection.md` there with the choice, reasons,
rejected alternatives, and artifact paths. Return the exact next invocation:
`/change <intent-or-change> --prototype-selection <selection-path>`.
Everything remains non-authoritative and must never enter proof or evidence.
