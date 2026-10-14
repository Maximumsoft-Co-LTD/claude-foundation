# Paid E2E and multi-session Investigate comparison — 2026-10-15

[ภาษาไทย](continuity-paid-e2e-2026-10-15.th.md)

Current clean source `6211780127a69c2166d61a24cf8eed8a3ce3f20e` delivers 9/10
maintained paid scenarios. Tracker again fails `CASE_TESTS_EXIST` at 32/33 and
remains `proven`; it was not Landed. The new Investigate conversation preserves
structured history, but an independent ambiguous-timeout probe fails against
its generated prototype. This is not a green release checkpoint or a claim
that the new version satisfies all payment semantics.

## Execution boundary

The user authorized US$200 total. Ten maintained lanes used their matrix
ceilings (US$105 combined), followed by eight user turns in each of two
disposable research consumers (US$20 per consumer). Actual measured host costs
are US$4.4735401 for the portfolio, US$6.0970157 for before-research and
US$6.1689378 for after-research: **US$16.7394936** this checkpoint, or
US$17.2587553 including the earlier Notes API smoke. These are CLI envelope
costs, not an account invoice or an estimate for unmeasured dimensions.

Claude Code 2.1.299, Node 26.3.0, `claude-sonnet-5-5` explicitly pinned and
observed in streams, maximum four concurrent hosts. The frozen deterministic
sentinel passed all 12 rows before paid dispatch. Product source was not edited.
The disposable delivery lab uses its documented self-review and backend Land
authority; the hidden task oracle runs before Land. Research consumers were
explicitly prohibited from Build, Land, Git writes and real payment calls.

## Ten paid delivery scenarios

Each cell below is host seconds / measured host cost / oracle score. The prior
values are the [v3.6.3 candidate](scenario-checkpoint-v3.6.3-2026-10-11.md),
not new executions of that release.

| Scenario | Historical v3.6.3 | Current clean source | Current terminal |
|---|---|---|---|
| bare-node-boundary | 50.6 / $0.3409 / 6/6 | 51.8 / $0.3438 / 6/6 | archived |
| typescript-react-state | 42.5 / $0.3197 / 6/6 | 51.8 / $0.3435 / 6/6 | archived |
| python-api-validation | 39.5 / $0.3145 / 5/5 | 41.2 / $0.3373 / 5/5 | archived |
| database-migration-rollback | 80.8 / $0.3237 / 6/6 | 72.9 / $0.3463 / 6/6 | archived |
| refactor-no-reproduction | 45.3 / $0.3197 / 6/6 | 60.1 / $0.3616 / 6/6 | archived |
| multi-service-event-flow | 96.7 / $0.3543 / 6/6 | 95.2 / $0.3626 / 6/6 | archived |
| tiny-feature | 33.7 / $0.2893 / 8/8 | 92.9 / $0.3715 / 8/8 | archived |
| notes-api | 135.2 / $0.5003 / 13/13 | 163.8 / $0.4604 / 13/13 | archived |
| cart-coupons | 103.7 / $0.5047 / 11/11 | 140.6 / $0.5978 / 11/11 | archived |
| project-tracker-api | 390.0 / $1.1146 / 32/33 | 337.5 / $0.9487 / 32/33 | proven; failed |

All nine successes pass quality, ordinary project command, clean installation
and post-install tests, with zero pending tasks. Tracker's two host envelopes
sum to US$0.9486703; clean-install/quality results are unavailable after the
oracle failure and are not counted as pass or zero. The repair continuation
does not clear the hidden test-adequacy failure. No oracle was weakened.
The retained v3.6.0, v3.6.1, v3.6.2 and v3.6.3 cohorts all delivered 9/10 with
the same Tracker failure. Current results do not show that defect fixed.

There is one repeat per scenario, different host versions and non-interleaved
batches. This batch also overlaps with research hosts. Timing differences,
including the slower tiny-feature, are observations rather than causal or
stable performance improvements/regressions.

## Paid Investigate conversation

Before source is the immediate pre-change commit
`d157286b9b32c4374fcb94accf7c1a430c04228d`; after source is the current clean
commit above. Both receive the same seed and eight user messages: ambiguous
retry request, policy answers, revision correction, fresh-session Change
request, further answers, another Change request, explicit selection/cross-key
semantics, and final fresh-session Change request. The first three messages
resume one chat; later messages start fresh chats and rely on saved artifacts.

| Observation | Before | After |
|---|---|---|
| Research product files unchanged | All 8 snapshots | All 8 snapshots |
| Measured cost | $6.0970157 | $6.1689378 |
| Sum of host-turn wall times | 1204.746 s | 1151.667 s |
| Observed model requests | 145 | 138 |
| Requirements/history | Authored note and hand-maintained design context | 16 typed revisions, 13 active requirements, 3 superseded revisions |
| PoC history | Authored note/selection addenda | 4 retained experiments; 2 completed and 2 superseded planned experiments |
| Native packet | Valid, 29 claims, awaiting approval | Valid, 20 claims, awaiting approval |
| Proposal words | 1435 | 4307 |

The after-agent keeps prior A/B/C findings unchanged and reruns only the
selected affected alternative after the cross-key correction. Its local PoC
reports 15/15. Both packets retain material constraints and measured limitations;
neither consumer proceeds to application Build or archive. The before-agent
also preserves history manually, so missing v2 fields are not treated as proof
that it lost all user meaning. This single comparison is not a win-rate study.

**Independent counterexample:** simulate an upstream charge whose response is
lost, then submit the same payment id/revision using another key. Inject this
same local scenario into both generated prototypes; call no real gateway.

| Generated prototype | First status | Second status | Simulated upstream charges | Safety criterion |
|---|---:|---:|---:|---|
| Before, B4 | 504 | 409 | 1 | pass |
| After, B2 | 504 | 201 | 2 | fail |

The after spec explicitly says an unknown timed-out sibling does not block a
second key. Its investigation declares all material questions answered and
`ready-for-change`, while its conclusion still says unknown timeout outcomes
are open for Change. The final agent asks about this consequential behavior
only at spec approval. Structural coverage and a valid packet did not establish
semantic equivalence with the intended no-duplicate-charge outcome. Approval
was not granted. This is a finding about one generated design and handoff, not
proof that every run of the new harness generates this defect.

Remaining work: route known unresolved counterexamples into material questions
before handoff; retain concise current intent with selectively loaded history;
include an independent ambiguous-timeout acceptance case; repair Tracker's
oracle-to-repair/test-adequacy path. Internal module placement should remain an
agent implementation decision unless it changes user-visible semantics.

## Infrastructure findings and evidence retention

The first ten experiment wrappers did not dispatch a model: `/tmp` versus
`/private/tmp` broke the runner's entrypoint identity check. The lab nevertheless
returned `strictPass: true` with empty runner output and no scorecard. These
attempts are retained as **invalid/no-dispatch**, excluded from the 10 paid
results. The wrapper was canonicalized and a free dry-run confirmed the host
plan before new run IDs were dispatched. The lab still needs a fail-closed
nonempty scorecard/lifecycle/oracle gate; its manifest boolean alone is unsafe.

The research PoCs initially hit a headless `node` permission denial. They stayed
planned, with no fabricated execution results. Continuation explicitly added
only `Bash(node .foundation/prototypes/*)` in disposable consumers, and supplied
the remaining policy/selection answers. Both arms received the same changes.

All 381 indexed files in the ten real delivery bundles and 1361 indexed files
in the two research bundles passed checksum checks. Temporary consumers were
removed after evidence retention.
Streams, session envelopes, source identities, oracle, install/quality checks,
research snapshots, compiled packets, validation output, fixtures and helper
instrumentation are retained outside Git:

```text
~/.local/share/changeloop/benchmarks/2026-10-15-continuity-paid-e2e.tar.gz
SHA256 dbe64d8d3e2def8f4abbb7e82bcaeac894b6c37c4086d973fdcea0e0f48ff66a

~/.local/share/changeloop/benchmarks/2026-10-15-continuity-semantic-counterexample.tar.gz
SHA256 b6369a5d3ccb6d0044e8d1a6aaa0f550accbe2c41e865fdf8714fcc99f4c8750
```

The second bundle retains the independently authored adversarial probe and its
actual results; it uses the prototypes in the first bundle. The deterministic
[19-check comparison](investigation-continuity-differential-2026-10-15.md)
remains valid evidence for structural guards, but it does not supersede this
semantic failure. No release or production assurance is promoted.
