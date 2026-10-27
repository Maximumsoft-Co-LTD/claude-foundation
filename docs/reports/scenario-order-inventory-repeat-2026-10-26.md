# Order-inventory repeat: `52c3e50c9` — 2026-10-26

**Status:** observed evidence, one lane (`order-inventory`), four paid runs.
`repeated-green` for this lane only; not the full paid checkpoint.
[ภาษาไทย](scenario-order-inventory-repeat-2026-10-26.th.md)

## Scope and conditions

| Item | Value |
|---|---|
| Source | `52c3e50c9`. Run 1 clean. Runs 2–4 carry one uncommitted bench-only patch (`quality.mjs`, below) and share one patch digest |
| Lane | `order-inventory`: brownfield `backend`/`sdk`/`web`, SQLite, tenant isolation, cross-process concurrency, oracle 19 cases |
| Ceilings | 90 min, US$25, 400 model requests, 600 tool calls per run |
| Authority | User cap US$1000, one lane, disposable consumers, no commit or push |
| Host | Claude Code only; requested and actual model names unavailable |

## Results

| Run | Digest | Archived | Oracle | Cost | Wall | Missing sections |
|---|---|---|---|---|---|---|
| 1 | clean | yes | 19/19 | US$1.4026 | 10.8 min | 4 (metric artifact) |
| 2 | patched | yes | 19/19 | US$1.2550 | 10.0 min | 0 |
| 3 | patched | yes | 19/19 | US$0.9967 | 6.6 min | 0 |
| 4 | patched | yes | 19/19 | US$1.0220 | 6.8 min | 0 |

All runs: 0 pending tasks, 0 repairs, 0 `ASK_USER`, delivered tests 30/30,
clean offline install pass, product quality 64/64 with no failures. Total
spend ≈ US$4.68. The release report classes the lane `repeated-green` from
runs 2–4 (3 strict passes, one commit and patch digest): median cost
US$1.022, median wall 407.6 s, median 21 model requests, 0 resumptions.

## Findings

- **Missing sections were a metric artifact.** The scorecard counted
  Summary, Success criteria, Provenance and Overview as required, but the
  renderer omits empty rows and the draft validator never requires them.
  `quality.mjs` now excludes them; a regression test covers it. Run 1 keeps
  its original count of 4.
- **Task ledger complete.** The archived `tasks.md` of run 1 has T001–T003 done,
  each with its claims. The 2026-10-12 audit's incomplete ledger did not recur.
- **Open review findings at Land (run 1).** Three minor findings remained open
  in the archived packet: delivered concurrency tests run both servers in one
  process (`spawnSync`) so requests never overlap (the oracle's real
  two-process test does prove it); SDK sends `"null"` as idempotency key for
  `null`; `setStock` splits settle and upsert into two transactions. Runs 2–4
  were not inspected for review findings.

## Limits

- One of 28 paid lanes; the portfolio report stays `blocked` (other lanes have
  no paid smoke; time-gate advisory fails at rapid 2.09× and standard 1.88×).
- Model name, model active time and tooling quality are unavailable, not zero.
  Observed model requests (21–24) differ from host-reported (42–53); not
  reconciled.
- Levels 3–4 (amendment, stacked Land, interruption) are not exercised.
- Raw bundles remain under `.claude/tests/bench/results/openspec-native-lab/`
  (`order-inventory-1792998061631`, `-1792999976780`, `-1793000657434`,
  `-1793001235384`); no checksummed archive outside Git was made.
