# Structured decision policy

Only deterministic recovery may be followed automatically. When an `advance`
action has `recovery.type: AUTO_RECOVER`, execute its one offered route within
current authority, explain the repair in plain language, and continue with its
exact `resume` command.

Every other `ASK_USER`, including one emitted by a blocked operation, requires
an explicit user answer. Present honest alternatives, recommend one with a
reason, and preserve reject, inconclusive, or pause whenever valid. Never infer
approval from silence or from the ability to invoke an authority command.

The agent creates requests, responses, flags, and provenance after the human
decision. Users never assemble harness commands or JSON.

For human review or acceptance, present the concrete scope, findings, and exact
verdict to be recorded; ask for the user's decision only if it is missing.
Permission to run a command is not a human review verdict. Never turn an
agent-authored response into a human pass without the user's explicit adoption
of that verdict. Reuse an explicit answer for the same unchanged scope/verdict.
After confirmation, the agent runs the offered `authority dispatch` and
`authority record` routes as applicable, verifies the result, and resumes.
Human ownership of the decision does not require human CLI execution.

Claim a host permission block only when a tool returned an actual denial; retain
the denied action and stated reason. If the host offers a permission approval
flow, request it there and execute after approval. A hard deny remains binding:
do not bypass it, weaken settings, or ask the user to execute the blocked command
with a shell escape such as `!`. Report the real boundary and preserve the
agent-owned resume route; never invent a session permission restriction.
