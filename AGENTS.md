# Repository instructions for coding agents

## Scope

These instructions apply to the entire repository. This repository is the
upstream source of Change Loop, an installable OpenSpec-native control
plane for AI-assisted software changes. It is not a consumer application.

The product lifecycle is:

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec owns the agreement; the coding agent owns implementation; project
tools produce evidence; the harness owns state, isolation, budgets, proof,
authority, and recoverable Land.

For new work, the agent states semantics once in draft v3 and `change start`
compiles stable OpenSpec links and conditional artifacts. After Change, the
normal model-facing runtime entrypoint is `advance --through
build|proven|archived`; primitive commands remain compatibility/diagnostic
surfaces. The compiled OpenSpec packet—not the draft or `.foundation`—is the
agreement source of truth.

## Non-negotiable invariants

- Preserve public command names and arguments unless the task explicitly
  authorizes a compatibility break.
- Build writes only inside the declared isolated workspace.
- Gates aggregate independent findings, repair one dependency-ordered batch,
  and selectively rerun invalidated checks.
- Product repair has no fixed retry count while progress changes.
- Stop only at a real authority, resource, budget, conflict, or repeated
  no-progress boundary; preserve state and return an exact resume route.
- A delivery flow is complete only at `archived`. `proven` is not completion.
- Never fabricate evidence, convert unavailable measurements to zero/pass, edit
  machine-owned proof JSON, or infer user authority.
- Land never implies permission to commit, push, publish, or open a PR.

## Read before editing

Use the smallest relevant canonical source:

- `README.md` / `README.th.md` — user behavior.
- `WORKFLOW.md` — detailed lifecycle contract.
- `.claude/harness/README.md` — runtime structure and operator surface.
- `.claude/harness/EVIDENCE.md` — provider and receipt semantics.
- `.claude/harness/protocol.json` — wire-visible version pins.
- `.claude/tests/README.md` — suite ownership and regression placement.
- `CLAUDE.md` — maintainer workflow, shipping boundary, and source map.
- `docs/reports/README.md` — current versus historical reports.

Do not duplicate a canonical contract into another guide. Link to it and keep
summaries short. Keep English and Thai public documentation aligned.

## Working method

1. Inspect the dirty worktree and preserve changes not created for the task.
2. Classify the edit as runtime, instruction, shipping, repository-only, or
   release work.
3. Read the nearest implementation and tests before changing code.
4. Keep edits surgical. Put new runtime behavior in its domain under
   `.claude/harness/runtime/`; keep `foundation.mjs` a composition root.
5. Add a deterministic regression at the lowest boundary that catches the bug.
6. Update command registry, protocol pins, installer ownership, and canonical
   docs only when their actual contracts change.
7. Run focused tests while iterating and the authoritative suite before commit.

## Shell and file rules

- Always prefix shell commands with `rtk`. In chains, prefix every segment.
- Prefer `rg`/`rg --files` for search; use `rtk grep`, `rtk find`, or
  `rtk proxy rg` as appropriate.
- Use patch-based edits. Do not overwrite files through shell redirection.
- Do not run destructive Git commands or remove user work.
- Do not commit generated `.foundation` state, benchmark results, website build
  output, caches, temporary consumers, or secrets.
- Do not commit, push, publish, or run paid scenarios without explicit user
  authority.

## Verification

```bash
rtk test bash .claude/tests/run-all.sh --affected
rtk test bash .claude/tests/run-all.sh
rtk test bash .claude/tests/docs/run-doc-consistency.sh
rtk npm run build                         # run from website/docs
rtk npm run bench:openspec-native:sentinel
rtk npm run release:preflight
rtk git diff --check
```

The full `.claude/tests/run-all.sh` run is the authoritative deterministic
gate. A changed shipped file requires the full suite before commit. Website
documentation changes require the docs build. Wire-visible changes require the
matching protocol pin and upgrade coverage.

Paid scenario evidence is a separate, explicitly authorized release activity.
Use disposable consumer labs, require `archived`, run the hidden oracle before
Land, and retain clean-install verification. There is no scheduled paid
portfolio workflow.

## Shipping ownership

`install.sh` `MANAGED` is authoritative for overwritten product files. Consumer
configuration, `CLAUDE.md`, `AGENTS.md`, OpenSpec changes, and `.foundation`
state are project-owned and must survive install/upgrade. Never make shipped
files depend on repository-only tests, reports, or release tooling.
