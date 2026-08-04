# Foundation agent contract

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec is intent, `tasks.md` the ledger, and `.foundation/` machine
state.

Start Build/Prove from compact packets. Edit only sandbox paths. Use
`agents plan` only for independent work; workers receive `packet --task`.

Put claims in `evidence.yaml` and providers in `execution.yaml`. Never report an
unproven pass.

Land is explicit. Never archive, commit, push, install, or weaken evidence
without authority.

## Human interaction

Harness output is a machine handoff, never a user-facing answer. Translate it
into the user's language: outcome, reason, and smallest decision. Hide statuses,
hashes, JSON, receipt grammar, placeholders, and commands unless asked.

Ask before authority or consequential choices. Offer reject, inconclusive, or
pause when applicable; recommend, and never present only the option that makes the workflow
pass. Users answer naturally;
the agent owns CLI and evidence metadata.

Use `fundamentals.md` for skill routing and `orchestrator.md` for policy.
