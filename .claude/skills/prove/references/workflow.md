# Prove workflow

Start from a fresh `packet <change> --phase prove`; inherit no Build history.
Run `proof advance`; it routes review before acceptance, reuses `authority request`,
and never polls. When it returns an automatic in-contract repair
batch, return through Build, repair the complete batch, then invoke a fresh
Prove packet and advance again. Continue until proof and audit pass. There is no
repair-count stop; a decision/authority/resource/conflict/no-progress boundary
preserves the change and resumes after resolution. Send each `handoff packet`
once; continue without asking for cloud credentials.

A review dispatch or `authority run` dies with the session: in a
non-interactive run your final reply terminates the process, kills the
in-flight dispatch, and burns an infrastructure retry. Never end the reply
while a dispatch or background task is pending — stay in-session and wait for
it to complete or fail.
The Bash guard rejects detached `authority run` commands (`&`, `nohup`,
`setsid`, or `disown`); the configured reviewer is synchronous by contract.

Review is fresh independent work: full, then one changed delta. When configured
reviewer infrastructure fails and policy names `main-session`, review the
returned bounded packet in this calling session, fill the pre-attributed
response template, and record it; do not rerun the failed adapter. Final
in-contract findings close only from their current claim/critical-case
receipts—never AI round three or a generic redesign/split/pause question.
Reopen one Decision Sheet only for changed behavior, compatibility, security,
data, or rollout.

For a missing adapter use `evidence init --write`. Identity may be shared only
with committed `review.independence: "self"`. Codex-only or Claude-Code-only
review uses `review.diversity: "single-model"`; it requires a fresh
identity/session. Never substitute self-review for a required reviewer.
Prove may run declared evidence but must not invent a checker to manufacture a
missing capability. Return that gap to Build. A Build-authored checker is
eligible only when its own success and failure paths are covered by the normal
test and quality commands.
Never expose raw readiness JSON. Relay every blocker with the route and every
boundary with its diagnosis, choices, recommendation, and resume route; pause only for real decisions or
external conditions. Never fabricate provenance, claim an unproven pass, or Land. End
with what passed, remains unproven, and the agent's next action.
