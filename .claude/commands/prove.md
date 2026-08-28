---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS** from a fresh `packet <change> --phase prove`; inherit no
Build history.

Treat `verificationPlan` as the check schedule: run its boundary command once,
and do not run `avoidBefore` commands unless an invalidation reason changed.

Read `.claude/skills/prove/references/workflow.md` completely and follow it as
the selectively loaded canonical Prove workflow. It owns evidence collection,
fresh independent review, authority routing, bounded recovery, and proof
finalization. Treat the text after `/prove` as its arguments.

Never fabricate evidence or Land. Report what passed, what remains unproven,
and the agent's next action in the user's language.
