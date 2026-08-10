# Change: refresh the website and human-facing docs to 3.2.8 and document artifacts, evidence, providers, and human approval

## Why

The repository's documentation has split into two tiers with different update
discipline. Agent-facing shipped files (`WORKFLOW.md`,
`.claude/harness/EVIDENCE.md`, `.claude/orchestrator.md`) are current at 3.2.8
because `run-doc-consistency.sh` asserts `WORKFLOW.md` carries the current
`VERSION`. Every surface without such an assertion drifted: `README.md`,
`README.th.md`, `website/index.html`, and `website/docs/**` have not been
updated since 2026-08-06/07 and are four to five releases behind.

Three claims are wrong today rather than merely incomplete:

- `.claude/harness/README.md:288` states "Four adapters are available" and its
  table omits `contract-digest`. This file installs into every consumer
  repository on every install, so a shipped operator guide contradicts the
  shipped `EVIDENCE.md` two files away.
- The website states `v3.2.4`, `runtime API 14`, and `runtime 2.7.0` in six
  places against an actual `3.2.8` / `17` / `2.8.0`. One of them
  (`website/docs/src/content/docs/index.md:52`) uses the pin to tell readers
  which receipts read as `provider-version-stale`, so the wrong number actively
  misleads about re-proving.
- Four separate `.foundation/` listings each describe a different partial
  subset of the 13 directories actually on disk. `WORKFLOW.md:570-590` omits
  `evidence/`, the immutable proof vault.

Beyond the errors, four topics a user needs are thin or absent: what artifacts
the system produces, how evidence works, how providers are wired, and how human
approval is handled. Human approval is the widest gap — `README.md` mentions
`acceptance` exactly once, and the rule that a standard change starts
`undecided` and **fails `change validate` until a human decides** is a hard,
user-visible blocker documented only in `WORKFLOW.md` and one website page.

Findings and their verification are recorded in
`openspec/investigations/docs-and-website-refresh.md`.

## What changes

- Shipped operator documentation names every adapter the runtime implements,
  so `contract-digest` stops being invisible to consumers.
- Human-facing documentation states the release and protocol pins the
  repository actually carries, and a deterministic check fails when any of them
  drifts — the guard that `WORKFLOW.md` already had and nothing else did.
- One canonical `.foundation/` artifact table describes what the system writes;
  the other listings point at it instead of contradicting it.
- The docs site gains pages covering artifacts, evidence, providers, and human
  approval, in English and Thai, with `README.md` and `README.th.md` pointing
  at them rather than duplicating them.
- Documentation distinguishes the four approval boundaries the runtime actually
  implements — `acceptance`, `review`, the authority request/record bridge, and
  host attestation — and does not claim Land gates on human consent, because it
  gates on evidence.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped operator documentation
  (`.claude/harness/README.md`, `WORKFLOW.md`), repository-only human
  documentation (`README.md`, `README.th.md`, `website/**`), and the
  deterministic documentation test suite.
- **Security triggers:** none

## Non-goals

- No runtime, CLI, schema, or protocol behavior changes. No pin in
  `protocol.json` moves.
- No new accessibility tooling. The repository has none, and the landing-page
  edits are text-only.
- No restructure of the docs site's navigation or styling beyond adding pages.
- No rewrite of the agent-facing docs that are already current
  (`EVIDENCE.md`, `orchestrator.md`), beyond the `.foundation/` listing.
- No release. `VERSION` and `CHANGELOG.md` are untouched.
