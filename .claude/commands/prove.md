---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS** from a fresh `packet <change> --phase prove`; inherit no
Build history. Run the packet's `verificationPlan.execution.command` once
before loading any further reference. A completed proof needs no manual
inspection or reference-file reread.

Treat `verificationPlan` as the check schedule: run its boundary command once,
and do not run `avoidBefore` commands unless an invalidation reason changed.
Obey its `convergence` contract.

Only when that command returns action-required or a decision boundary, read
`.claude/skills/prove/references/workflow.md` completely and follow the named
recovery route. It owns evidence repair, review/authority routing, and proof
finalization. Do not inspect an installed harness or search for alternate
commands; the boundary result and repair plan are authoritative.

Never fabricate evidence or Land. Report what passed, what remains unproven,
and the agent's next action in the user's language.
