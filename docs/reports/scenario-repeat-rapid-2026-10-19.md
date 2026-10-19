# Repeated rapid-tier runs after the overhead fixes — 2026-10-19

[ภาษาไทย](scenario-repeat-rapid-2026-10-19.th.md)

This report follows the
[2026-10-19 `9f1c09bf2` checkpoint](scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.md).
That checkpoint had the rapid tier at 2.03× the no-harness baseline, against a
1.5× target. The overhead fixes below were then rerun in **three paired rounds
per row**, alternating Change Loop and no-harness runs. Of 42 counted runs, 41
reached the full oracle score; one Change Loop run on `0660d1329` failed.
The rapid-tier median ratio is now **2.01×**, still above the target. The
maintainer chose to record this instead of blocking the release.

## Execution boundary

- Sources (all clean, sentinel 29/29 on each):
  - `0660d1329` (A, B, C4, C5): `config-flag` only, stopped after its first
    three pairs.
  - `3fdea70b6` (C4 reverted): all five rows.
  - `0131bc704` (fix E): `regression-fix-with-fixes` rerun.
- `ANTHROPIC_MODEL=claude-sonnet-5-5`, Claude Code 2.1.302, Node v26.11.1,
  macOS 26.7 arm64. Matrix budgets were unchanged, runs went one at a time, and
  the two arms were interleaved within each row.
- The full suite was run with `FOUNDATION_TEST_JOBS=6`. The default 24-way pool
  timed out three heavy suites on this loaded machine; those suites pass in
  isolation, and nothing about which suites run or their limits changed.
- Measured host cost: **US$13.5001** (42 counted runs). An interrupted
  `regression-fix-with-fixes` run, stopped because it would have rerun extra
  rows, has no measured cost (at most about US$0.5). It is kept outside the
  results.
- Stop rule (maintainer): pause when a row's Change Loop median is more than
  30% slower than v3.6.5. It paused for `config-flag` on `0660d1329` and for
  `library-cli-flag`. The maintainer then chose to continue without further
  pauses.

## Fixes under test

| ID | Change | Commit |
|---|---|---|
| A | A derived requirement outcome never carries placeholder-shaped scenario text | `d514458` |
| B | `--through` without `--approve-spec` prints the one approval call; `change.md` and the template put the flags on the same `change start` | `7a09960`, `cbff509` |
| C4 | Fast-class review for rapid `input-domain`: **reverted** in `3fdea70` by maintainer decision | `cbff509` → `3fdea70` |
| C5 | Risk signals persist before resolve, so the start line names the medium-tier review | `cbff509` |
| E | An unnamed `modified` requirement resolves to its canonical requirement; the repair lists the choices | `0131bc7` |

C3 (slimming the rapid template) was not done. The only safely removable
part was a 600-byte example covered by a contract test. The work-type examples
are the source of required sections, and removing them would add repair
rounds.

## Results

Each cell is Change Loop wall seconds per round, then the medians for Change
Loop and no-harness and their ratio. Every Change Loop run is archived with the
full oracle score unless a note says otherwise.

| Row (tier) | Source | Change Loop rounds | CL median | NH median | ×NH | vs v3.6.5 |
|---|---|---|---|---|---|---|
| config-flag (rapid) | `0660d1329` | 111.9 / 76.0 / **284.3 (failed 9/11)** | 111.9 | 52.1 | 2.15 | +37% |
| config-flag (rapid) | `3fdea70b6` | 102.1 / 111.1 / 94.6 | 102.1 | 54.7 | 1.87 | +25% |
| library-cli-flag (rapid) | `3fdea70b6` | 49.9 / 66.2 / 59.5 | 59.5 | 36.0 | 1.65 | +44% |
| regression-fix-with-fixes (rapid) | `3fdea70b6` | 109.6 / 106.9 / 136.0 | 109.6 | 27.8 | 3.94 | +39% |
| regression-fix-with-fixes (rapid) | `0131bc704` | 57.0 / 70.5 / 85.1 | **70.5** | 31.6 | 2.23 | **−11%** |
| tiny-feature (rapid) | `3fdea70b6` | 100.8 / 63.0 / 68.0 | 68.0 | 32.9 | 2.07 | +4% |
| refactor-no-reproduction (standard) | `3fdea70b6` | 69.5 / 111.7 / 70.2 | 70.2 | 47.4 | 1.48 | +69% |

`time-gate.mjs` combines `3fdea70b6` with `0131bc704` for
regression-fix-with-fixes:

| Tier | Paired rows | CL median | NH median | Ratio | Target | Result |
|---|---|---|---|---|---|---|
| Rapid | 4 | 69.3 s | 34.5 s | **2.01×** | 1.5× | fail |
| Standard | 1 | 70.2 s | 47.4 s | 1.48× | 1.8× | pass |

The v3.6.5 reference for library-cli-flag (41.3 s) and refactor-no-reproduction
(41.5 s) is a fast single run. v3.6.4 took 56.8 s and 82.3 s on the same rows.

## Findings

1. **E removes the largest avoidable cost in this portfolio.**
   - On `3fdea70b6`, every regression-fix run got 1–3
     `cannot find canonical requirement` repairs. The draft declared
     `operation: "modified"` with keys such as `loyalty-tiers`, and the repair
     named no choices.
   - On `0131bc704`, no run got that repair. The median dropped from 109.6 s
     to 70.5 s, and requests from 17–22 to 12–16.
2. **A and B cut repair rounds where they applied.** library-cli-flag went from
   15 requests (n=1) to 7–10, with no false placeholder repair.
3. **The `config-flag` failure is a product defect that passed review.** On
   `0660d1329`, round 3 reached `proven`, and its configured (Opus) delta
   review passed. The hidden oracle then failed `CASE_DEFAULT` and
   `CASE_ENV_BEATS_FILE` before Land. The next six runs passed 11/11.
4. **C4 did not apply at Prove, and it was reverted.**
   - At Prove, the `input-domain` row also carried
     `independence-waived-self-review`, so the fast-class rule never matched.
   - After finding 3, the maintainer kept the standard class instead of
     weakening review.
5. **The remaining rapid overhead is lifecycle structure, not single bugs.**
   - Draft authoring, the template read, and the start/advance round trips
     still add about 30–35 s per rapid row.
   - Medium-tier review adds more on `input-domain` rows.

## Retained runs

```text
~/.local/share/changeloop/benchmarks/2026-10-19-repeat-rapid-0660d1329-3fdea70b6.tar.gz
sha256 bf639441b950ebc66f9cbc840a03218c8036035006418b17ca550abf77a87723
~/.local/share/changeloop/benchmarks/2026-10-19-repeat-regression-fix-0131bc704.tar.gz
sha256 391315d26f6a47da7b65f467c085347b129f8a07fc252a24ca94ea7fec10d514
```

Resume: reducing rapid-tier structure further (optional rapid fields, a merged
`dev.md`/`change.md` read) is a product decision for a later release. Before a
speed claim, repeat any row that changes.
