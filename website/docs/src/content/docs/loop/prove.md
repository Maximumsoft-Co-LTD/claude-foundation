---
title: /prove
description: Reuse and execute content-bound evidence until proven or a real boundary.
---

```text
/prove <change>
```

Run:

```bash
claude-foundation advance <change> --through proven
```

The coordinator validates the current agreement and workspace, reuses receipts
whose inputs are still current, executes eligible independent providers once,
routes review before acceptance, finalizes the proof bundle, and audits it. It
returns `DONE` only when the requested `proven` target is reached.

Failed evidence returns one `REPAIR` or `EDIT` batch with the invalidated claim
closure. After a fix, only invalidated/downstream checks rerun. A configured
review is `RUN_EXTERNAL`; a named external owner is `WAIT` without a question; a material
contract or acceptance decision is `ASK_USER`. Each boundary preserves state
and gives one exact resume route. Repeating an unchanged wait does not poll,
rerun evidence, or spend another model request.

Recovery observations survive process restarts. The third unchanged repair
handoff first asks the agent for one materially different approach inside the
agreement; only a further unchanged handoff asks how to proceed, with the cause,
attempted work, alternatives and a recommendation. The agent records an explicit
retry/pause answer with
`advance --decision`, the returned fingerprint, a decision reference and reason.
The harness resumes the original target and reuses the answer while its scope is
unchanged. Waiting names the owner and condition; pausing does not run setup or
providers. A retry grants no waiver, extra budget, or Land authority.

The harness never fabricates evidence, converts unavailable measurements to
zero/pass, or lets review prose replace a missing behavioral result. Prototype
artifacts are rejected as proof. Integration claims can require security,
compatibility, resilience, and signed external evidence as declared by the
agreement.

`proof readiness`, `proof advance`, provider, receipt, and authority commands
remain compatible advanced surfaces under `help --all`; normal agents do not
compose them manually. `DONE` at `proven` does not supply Land authority.
