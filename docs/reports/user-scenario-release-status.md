# User scenario release status

Artifact publication last verified: 2026-10-08 for v3.6.0.

Current release: [v3.6.0](https://github.com/Maximumsoft-Co-LTD/claude-foundation/releases/tag/v3.6.0),
source tag commit `b404be47db136fb3fc97eb714dab286dd0859695`.
The reviewed preparation commit is
`3b4df8c0c0ea3c470792f592b817c0d2b38a3a5f`; the release workflow generated the
versioned source and the subsequent formula/bottle commit
`4a687e5443c94687e7fe559401f4e26bc38b660b`.
See the [v3.6.0 changelog](../../CHANGELOG.md#360---2026-10-08) for scope.
Production assurance and the matched reviewed-baseline comparison remain open.

## Published v3.6.0 verification

| Check | Result and source boundary |
|---|---|
| Linux CI | PASS — [run 37742140059](https://github.com/Maximumsoft-Co-LTD/claude-foundation/actions/runs/37742140059), minimum runtime and all 225 deterministic suites; docs consistency 137/137 |
| macOS release rehearsal | PASS — [run 37742530125](https://github.com/Maximumsoft-Co-LTD/claude-foundation/actions/runs/37742530125), source-bound deterministic/semantic, automated mutation, rewritten candidate, and bottle checks |
| Publication and docs deployment | PASS — [run 37744361813](https://github.com/Maximumsoft-Co-LTD/claude-foundation/actions/runs/37744361813), reused the same source-bound rehearsal; release and deploy jobs succeeded |
| Supported upgrade matrix before publication | PASS — 60 tags × 4 adapters, 240/240 on clean preparation source; VERSION was still 3.5.30 before the workflow rewrite |
| Upgrade from v3.5.30 to published runtime | PASS — all 4 adapters on clean formula commit `4a687e544`; active changes and the user-owned file preserved, installed runtime reports 3.6.0 |
| Published source artifact | PASS — SHA256 matches formula; disposable fresh consumer install and CLI version/help pass |
| Published bottle | PASS — arm64_sequoia asset checksum matches formula; packaged VERSION is 3.6.0 |
| Live website and EN/TH docs | PASS — landing page, `/docs/`, and `/docs/th/` report v3.6.0 |
| Paid repeats, benchmark quality/speed, and rollout | Advisory/open — previous dirty-source comparisons do not establish assurance for this tag |

Retained local checks are under ignored `.foundation/test-results/release/`:
`upgrade-v3.6.0-source.json`, `rehearsal-v3.6.0/manifest.json`,
`upgrade-v3.6.0-published.json`, and `published-v3.6.0/report.json`.
The published source SHA256 is
`0ebba8485b014e43ca56c123c45056dcb7097e0214174768f9196455c1b3e4ab`;
the bottle SHA256 is
`28882743b208f6dd8d765d34b0f3ce67a0608813589a3cabe43aa7a7090924bf`.

## Historical development evidence

The pre-release benchmark of 2026-10-01
([harness-benchmark-3.5.28-2026-10-01.md](harness-benchmark-3.5.28-2026-10-01.md))
is single-run (n=1) development evidence for v3.5.28 and archived 6/6 lanes with
5/6 fully correct; its two named defects shipped in v3.5.29. See the
[v3.6.0 changelog](../../CHANGELOG.md#360---2026-10-08) for the complete v3.6.0
scope. The historical verification table below certifies only v3.5.6.
No paid, rollout, or production evidence transfers between source cohorts;
the published cohort's production assurance has not been verified here.

The following working-tree checks preceded the clean preparation commit and
remain development evidence. Publication checks are recorded separately above.

## v3.6.0 candidate scope and verification

The candidate includes:

- faster Build/Prove execution, reusable content-bound checks, concurrent
  review, a low-risk rapid review exemption, and medium-tier first-round
  review on the `standard` model class;
- derived Change intake, proposal scope and acceptance traceability, a policy
  definition of done, and tasks kept in `tasks.md`;
- multi-repository, sibling, nested-repository, and submodule workspace and
  delivery fixes;
- Land protection for prior landed work and target edits, copy-mode merge
  checks, projection verification before archive, backups, and uncommitted
  Land undo;
- task verification, base-source test discrimination for behavior changes,
  strict OpenSpec lint, flake detection, and rejection of superseded reviews;
- shell routing, narrow installer permission rules, larger packet budgets,
  actionable recovery, and follow-up delivery to an existing PR; and
- removal of unused repository quality tooling and a Homebrew formula fix
  for the removed repository `.workflow/` directory.

Detailed behavior remains in [WORKFLOW.md](../../WORKFLOW.md); release mechanics
remain in [RELEASING.md](../../RELEASING.md). The benchmark's rapid 1.5x and
standard 1.8x wall-time targets are advisory, not a verified performance claim
for every workload.

Local checks observed on 2026-10-08 for this working-tree repair (development
evidence, not a retained immutable release manifest):

| Check | Result and limit |
|---|---|
| Authoritative repository suite | PASS — all 225 registered suites after the runtime repair and hook fixture isolation |
| Release preflight | 13/13 structural checks pass; exit 2 with `source-tree-not-immutable` because the repair is uncommitted; current version v3.5.30 |
| Documentation consistency | PASS — 137/137 assertions |
| Public documentation build | PASS — 37 pages; build emitted i18n collection and 404 entry warnings |
| Focused repair regressions | PASS — provider-bound review closure, reused-check review overlap in an installed consumer, async discrimination, scoped shell commands, environment-bound cache, and hook PATH isolation |
| Frozen deterministic sentinel | PASS — 11/11 scenarios, zero model spend; source marked dirty |
| Local packaging rehearsal | PASS — workspace archive, disposable consumer install, CLI version/help, formula syntax and style; retained report under ignored `.foundation/test-results/release/local/` |
| Upgrade matrix and macOS bottle rehearsal | Not rerun in this inspection |
| Paid comparison (development source) | 20 concurrent runs: 10 workloads × Change Loop/no-harness, n=1 each; oracle and clean-install 20/20, Change Loop archived 10/10, retained integrity 20/20; not immutable release assurance |
| Benchmark quality and time advisories | Raw aggregate strict passes 6/10 per arm; Node coverage path aliases produced synthetic zero despite positive raw execution hits, so CRAP sign-off is unresolved. Rapid time ratio 1.183; standard 2.112 versus the baseline without mandatory review |
| Release-cohort repeats and rollout | Not verified for an immutable candidate; no matched baseline with mandatory review was run |

The paid comparison ran from commit
`30047579a3e3a80cd4c8b2cd0705846ca401039a` plus patch digest
`sha256:4a68db7870c6301c1afc89075c0f44d54b86e93295376e3fca218d1e4149b47b`.
Its local retained report is under ignored
`.claude/tests/bench/results/parallel-20261008/REPORT.md`; these bundles are
development evidence, not distributed release assets. Both arms used main host
model `claude-sonnet-5-5`. The no-harness arm has no mandatory separate review;
the time ratio measures total delivery with different assurance work and does
not isolate harness overhead. Paid assurance remains open.

Before publishing, retain the final immutable source identity and fresh required
suite, mutation, documentation, upgrade, and packaging evidence. Packaging and
preflight changed, so perform the release workflow dry run under the release
procedure. The local results do not transfer to a different final source
identity, and publication still requires a clean candidate.

## v3.6.0 release preparation decision — 2026-10-08

The user deferred further standard-speed optimization and requested a v3.6.0
release plan. Include the completed unreleased work and the current provider
closure, async discrimination/review, scoped test/cache, and hook fixture
repairs. Defer review-packet optimization, intake/context changes, benchmark
coverage normalization, and the matched reviewed-baseline experiment to later
work. The 1.5x/1.8x figures remain advisory targets; this release must not claim
the standard target was met or that production assurance is complete.

Follow [RELEASING.md](../../RELEASING.md) for mechanics, in this order:

1. Review the final source diff and unreleased notes, align English/Thai public
   documentation, and retain the benchmark limitations above. Preserve the
   existing command and wire contracts. Let the release workflow rewrite
   version mirrors to 3.6.0.
2. After explicit Git authority, commit and push the reviewed source to main,
   then freeze its exact SHA. Retain clean-source preflight, supported upgrade
   matrix (all four adapters), and local packaging rehearsal evidence. Existing
   dirty-source checks remain development evidence.
3. Run the required Release workflow rehearsal with `version=3.6.0` and
   `dry_run=true`: authoritative deterministic/semantic gates, automated
   mutation checks, candidate rewrite, EN/TH docs validation/build, and the
   macOS bottle rehearsal. Retain its source-bound manifest and successful run
   id. The upgrade matrix runs before this workflow rehearsal.
4. Once publication is explicitly authorized, publish using that successful
   `rehearsal_run_id` and the same version/source SHA. The workflow owns release
   versioning, tag, source checksum, formula, bottle, and docs deployment. Any
   intervening source change requires fresh evidence.
5. Verify the published tag/source identity, release assets and checksums,
   fresh consumer install, supported upgrade with project-owned state
   preserved, CLI version/help, bottle availability, and EN/TH docs. If
   distribution fails, retain the previous known-good artifact as the recovery
   route and follow the release runbook; do not move a published tag.

Current preparation gaps are the reviewed clean source commit, supported
upgrade matrix, final-source CI/mutation evidence, and source-bound macOS
rehearsal. Paid repeat, coverage/CRAP, speed, dogfood, and pilot advisories are
tracked separately from artifact publication, as defined in RELEASING.md.

## Summary

The backend simplification is implemented. Public command names, arguments,
and phase order are unchanged. Change, Build, Prove, and Land now follow one
convergent contract:

1. Evaluate the gate once and collect all independent findings.
2. Turn in-contract findings into one dependency-ordered repair plan.
3. Repair the batch and rerun only invalidated checks.
4. Continue while the subject or repair strategy makes progress; there is no
   fixed product-repair limit.
5. Preserve the change and give an exact resume route only at a real authority,
   resource, conflict, budget, or repeated no-progress boundary.

Success for a code-delivery scenario means `archived`, not merely `proven`.
The hidden task oracle runs before Land, so an incorrect implementation cannot
be archived by a passing Change Loop proof alone.

## What changed

| Concern | New backend behavior | Primary source |
|---|---|---|
| Policy | Compile risk, authority, evidence, workspace, budget, and Land requirements once | `.claude/harness/runtime/core/execution-contract.mjs` |
| Lifecycle | Apply transitions through one reducer and derive runtime/proof/journal views | `.claude/harness/runtime/core/lifecycle-reducer.mjs`, `state-projections.mjs` |
| Gates | Aggregate findings, plan batch repairs, fingerprint progress, and resume without a repair-count cap | `.claude/harness/runtime/core/convergent-gate.mjs` |
| Authority | Stop before agent dispatch when signed CI, external review, or another real decision is unavailable | `.claude/harness/runtime/core/authority-policy.mjs` |
| Evidence | Use typed outcomes, signed semantic acceptance, stable cases/partitions, and automatic npm lockfile evidence | `.claude/harness/runtime/evidence/` |
| Isolation | Fail closed for unsafe or ambiguous writes while honoring declared host capability | `.claude/hooks/phase-mutation-guard.mjs` |
| Land | Require current proof, pre-Land oracle success, recoverable archive checkpoints, and truthful measured telemetry | `.claude/harness/runtime/workflow/land-runtime.mjs`, `apply-runtime.mjs` |
| Release evidence | Freeze seven fixtures, bind results to commit + patch digest, and separate paid runs from zero-model revalidation | `.claude/tests/bench/openspec-native/` |
| Human handoff | Keep routine commands and resume routes agent-owned; ask people only for decisions, authority, or external conditions | `.claude/orchestrator.md`, `.claude/harness/AGENT.md` |

User-facing behavior and recovery are documented in `README.md`,
`README.th.md`, and `WORKFLOW.md`. Release and rollout operations are documented
in `RELEASING.md` and `docs/reports/rollout-operations.md`.

## Verified state — historical v3.5.6 cohort

| Check | Result |
|---|---|
| Authoritative repository suite | PASS — all 200 registered suites |
| Documentation consistency | PASS — 132/132 assertions |
| Public documentation build | PASS — the v3.5.6 release workflow built and deployed English and Thai docs |
| Frozen deterministic scenario sentinel | PASS — 7/7 scenarios |
| Public command compatibility | PASS — 8 host commands and 72 CLI commands pinned |
| Release workflow | PASS — source-bound rehearsal `33885638882` and publishing run `33886638840` |
| Release paid evidence | NONE — the v3.5.6 cohort has 0/18 required runs |
| Previous dirty-source smoke | Historical only — `bare-node-boundary` reached `archived`, oracle 6/6, but cannot satisfy the clean candidate |
| Assurance report | BLOCKED — all six paid scenarios report `authorized-paid-smoke-missing` |
| Artifact publication | PUBLISHED — v3.5.6 source release, `arm64_sequoia` bottle, formula, and Pages deployment |

The earlier strict smoke and interrupted `bare-node-current-repeat2-20260903`
execution do not count for the clean candidate. The strict smoke belongs to a
different dirty source identity; the interrupted execution has no manifest.

## Remaining assurance work

Publishing a versioned artifact does not require the paid portfolio or rollout
observations. Candidate deterministic and packaging verification still needs
the fresh evidence described above.
Production assurance still requires:

- three independent passes for each of the six paid scenarios;
- 18 paid executions in total from the clean candidate cohort;
- a retained aggregate report from one immutable source cohort;
- dogfood and pilot observation required by the rollout policy.

Deterministic tests, historical runs, zero-model revalidation, and a published
artifact do not substitute for assurance. A benchmark or rollout report exit
code of 2 is a truthful assurance blocker, not a publication blocker or test
failure.

## Reproduce the evidence

```bash
rtk test bash .claude/tests/run-all.sh
rtk npm run bench:openspec-native:sentinel
rtk proxy node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario bare-node-boundary
rtk npm run bench:openspec-native:release-report -- \
  .claude/tests/bench/results/openspec-native-lab
rtk npm run release:preflight
```

Paid runs require explicit spend authority. The lab creates a disposable
consumer, installs the current source, executes through Land, verifies delivery
from a clean install, preserves a content-bound evidence bundle, and removes the
consumer unless `--keep-project` is explicitly supplied.

## Next assurance boundary

The published v3.6.0 tag is the assurance boundary. Before describing it as
`production-observed`:

- freeze its final source identity and run the paid portfolio from that one
  immutable candidate cohort;
- retain the aggregate report plus dogfood and pilot observations;
- keep ignored benchmark output and temporary consumers out of Git; and
- require the resulting assurance report to pass.

Any later source change creates a new identity. Paid evidence collected from a
dirty patch or different commit remains useful development evidence, but cannot
provide assurance sign-off for the final v3.6.0 candidate.
