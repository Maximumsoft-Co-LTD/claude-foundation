# Foundation agent contract

Use `/investigate` when the cause or agreement is unclear. Otherwise follow:

```text
/change → /build → /prove → /land
```

If the host has no slash-command support, use the same installed Markdown
commands as instructions and call the native `claude-foundation` CLI for state,
sandbox, proof, and Land operations.

OpenSpec change artifacts are the durable agreement, `tasks.md` is the only
implementation ledger, and `.foundation/` is machine state. Start Build with
`claude-foundation packet <change> --phase build` and Prove with
`claude-foundation packet <change> --phase prove`; do not replay prior
conversation or reload the full orchestrator. Phase checkpoints incrementally
sync request usage from the Claude transcript; never add per-tool token hooks.

- Change writes behavioral claims to `evidence.yaml` and executable wiring to
  `execution.yaml`.
- Build works in the harness sandbox and checks stable task IDs as outcomes pass.
- Prove runs `doctor --stage prove`, `proof preflight`, `proof execute`, and
  `proof audit`. Never report a pass without a valid receipt.
- Land is explicit. Never archive, commit, push, or open a PR unless requested.
- Do not auto-install project dependencies or weaken required evidence.
- Load `.claude/rules/fundamentals.md` only to route work to a relevant skill.

Use `.claude/orchestrator.md` only for detailed policy or troubleshooting.
