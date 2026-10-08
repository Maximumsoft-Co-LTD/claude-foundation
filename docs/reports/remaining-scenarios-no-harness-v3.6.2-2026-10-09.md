# Remaining scenarios: no harness versus v3.6.2 — 2026-10-09

[ภาษาไทย](remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md)

## Scope and interpretation

Completed all 14 omitted legacy workloads plus a reconstructed three-repository API-key workload, one repeat per arm. Both arms fully satisfy acceptance in 12/15 workloads; this is **not 12/15 release-green**. Three workloads fail acceptance in both arms, API keys fails a measured quality threshold in both, and Accumulate retains a superseded change at `proven`.

This exploratory supplement does not replace the [official ten-scenario comparison](scenario-benchmark-no-harness-2026-10-08.md) or promote legacy workloads into the [release matrix](user-scenario-test-plan.md). Runs started October 8 and ended October 9 Bangkok time. v3.6.2 source is clean commit `50ad2ce4d5ceccb8bee0c1b8c44d5387617fadec`. Both arms use observed model `claude-sonnet-5-5`, Claude Code 2.1.294 and Node 26.3.0; seeds and source pins were checked for all 34 raw bundles.

Direct implementation receives no Change Loop harness. Change Loop targets `archived`, followed by project tests and clean-install/retest. Hidden acceptance runs outside the consumer before Land. Accumulate consists of two separate requests in the same consumer. Repairs and continuations remain part of the same repeat.

## Per-scenario observations

Seconds measure the lab manifest interval, including host, oracle, quality and delivery checks, excluding seed/install preparation. CLI costs sum all retained final host envelopes, including continuations; they are estimates, not billing receipts. Missing values are not zero.

| Scenario | Acceptance direct / v3.6.2 | Seconds direct / v3.6.2 | CLI USD direct / v3.6.2 |
|---|---|---|---|
| 01 Task list | 3/3 / 3/3 | 74.772 / 84.514 | .195159 / .347670 |
| 02 CSV format | 3/3 / 3/3 | 32.744 / 45.024 | .170090 / .309857 |
| 03 Form validator | 5/5 / 5/5 | 31.813 / 52.720 | .173359 / .325768 |
| 04 Paginate | 5/5 / 5/5 | 40.702 / 57.463 | .209470 / .366351 |
| 05 Debounce | 4/4 / 4/4 | 45.013 / 60.150 | .181863 / .352064 |
| 06 Landing site | 5/5 / 5/5 | 79.787 / 105.327 | .326847 / .538581 |
| 07 Session token | 4/5 / 4/5 | 76.454 / 169.944 | .300952 / .509771 |
| 08 Name migration | 4/5 / 4/5 | 36.381 / 108.940 | .200762 / .550358 |
| 09 API compatibility | 4/5 / 4/5 | 54.875 / 103.270 | .220623 / .507921 |
| 10 Rounding fix | 5/5 / 5/5 | 52.812 / 71.264 | .228466 / .371023 |
| 12 Contact search | 5/5 / 5/5 | 36.940 / 77.208 | .189882 / .298647 |
| 13 Money drift | 7/7 / 7/7 | 69.768 / 122.991 | .282102 / .546528 |
| 14 Accumulate: search then sort | 10/10 / 10/10 | 78.628 / 231.582 | .425967 / ≥1.148591 |
| 14b Sort only | 5/5 / 5/5 | 47.055 / 64.998 | .190945 / .369074 |
| API keys: three repositories | 34/34 / 34/34 | 310.597 / 526.129 | 1.164713 / 1.393898 |

Successful ordinary direct deliveries have project tests and install/retest evidence; successful Change Loop deliveries reach `archived`. Task list and direct Accumulate required free posthoc delivery verification. Token, migration and API compatibility remain incomplete. API and Accumulate have the additional qualifications below.

## Time and cost against no harness

Only nine successful pairs without the listed grading/recovery contamination enter the performance comparison: CSV, form validation, pagination, debounce, landing site, rounding, contact search, money drift and sort-only.

Their combined lab time is 436.634 seconds direct versus 657.145 seconds with v3.6.2: **1.505× (+50.5%)**. Measured CLI cost is $1.9530254 versus $3.4778924: **1.781× (+78.1%)**. Each of these nine observed pairs is slower and more expensive with the harness. Single repeats, batches up to four concurrent jobs and different lifecycle endpoints do not establish stable overhead, quality improvement or an effect attributable specifically to the new skills.

Exclude Task list (grading-server error), all three failed workloads, Accumulate (grading/new-intent recovery) and API keys (permission recovery/reconstruction/quality failure). The table retains their actual times and costs without using them as performance evidence.

## Failures and delivery gaps

- **Session token:** direct HMAC tokens lack a nonce and repeat for the same user at a frozen time, failing randomness AC1. Change Loop uses random opaque, map-backed tokens but fails the historical signed-token/constant-time contract AC4. This does not establish that opaque tokens are inherently insecure.
- **Name migration:** both preserve the migrated data but use direct file writes without atomic replacement or backup, failing interruption safety AC4.
- **API compatibility:** both throw for invalid pagination inputs instead of returning the required empty/clamped response, failing AC5.
- **API keys:** both ultimately pass 34/34. Gateway, users submodule and SDK sibling are real Git repositories; Change Loop archived and passed per-repository tests/install/retest with all three HEADs and index hashes unchanged. Its gateway handler has cyclomatic complexity 49, coverage 90.77% and CRAP **50.89**, failing quality. Direct implementation also fails quality: complexity 41, coverage 85.71%, CRAP **45.90**. Its original project test failed 1/17: splitting a base64url secret on underscores creates an unstable secrecy assertion. Three later free repeats and nine per-repository checks passed; they do not erase the original failure.
- **Accumulate:** final search and sorting acceptance is 10/10 in both. Change Loop's final change archived, but an earlier superseded sorting attempt remains `proven`; its state is retained rather than manufacturing abandonment authority. The delivery continuation actually used 14 model requests and $0.4348036, included in costs.

Coverage/CRAP are collector measurements, not semantic correctness. Task-list Change Loop has minimum Node coverage 0%, mean 65.38%, despite passing browser acceptance and CRAP. Money-drift minimum coverage is 50% direct and 0% with Change Loop. Landing-page numeric coverage/CRAP is unavailable. Low-CRAP uncovered functions can still receive a collector pass; these results do not mean complete coverage.

## Experimental corrections retained with original evidence

The task-list browser server initially served `.mjs` with the wrong MIME type; a free corrected browser recheck passed 3/3. Migration grading accepts lossless camelCase or snake_case. API pagination metadata may derive `hasMore`. Accumulate checks rendered sorting and nonmutation rather than demanding reordered storage; a sort-specific mutation must fail the tests. Token clock control and independent probes were corrected. All original verdicts remain beside corrected results; machine-owned proof JSON was not edited.

Accumulate's runner initially treated a new second request as resuming the archived first request. The excluded preflight-only bundle dispatched no model. A new-intent adapter and later paid delivery continuation are retained separately.

The original API consumer source was unavailable, so a new seed reconstructs the historical 34-claim semantic draft with explicit entrypoints. Initial direct execution lacked sibling-directory permission; `--add-dir ../sdk` enabled a continuation. Deleted gateway/users Git metadata was reconstructed from retained product trees for that baseline continuation. Oracle adapters accept internal config shapes and use a well-formed unknown key. These are exploratory results, not an immutable matched replay of the original API consumer.

Utility/seed, domain and browser positive/negative controls passed (12, 6 and 4 checks respectively); API negative seed control was 3/34 and no full positive reference implementation preceded paid execution. Three free v3.6.2 diagnostic controls also passed: installed recovery, large-change packet and budget continuation. No-harness has no equivalent harness-state command; these controls are not paid comparative scenarios.

## Budget and retained evidence

The user authorized a new **$60** ceiling. There are **34 raw bundles, 38 host sessions and 37 final cost envelopes**. Known primary-host cost is **≥$12.3973022**. One missing envelope remains unknown; reserving its full $1.875 stage cap gives a conservative primary-host allocation of **$14.2723022**. Independent provider/review costs are not measured.

Private durable archive, outside Git and disposable state:

`/Users/hashtagf/.local/share/changeloop/benchmarks/2026-10-09-remaining-no-harness-v3.6.2.tar.gz`

SHA-256: `b3e3fabdb7fe92e3a405b867de884245f3e45e5291d6aac2a4b5a48d6380ea01`.

All **1,692 archived file hashes** were verified after extraction. A companion `.manifest.json` records file hashes. Included: pinned source tar, seeds, prompts, setup/runner/oracle scripts, controls, 34 bundles, host streams, patches, proof/state, original and corrected verdicts, supplemental checks and aggregate summary. Dependencies and Git metadata are excluded; absolute lab/oracle paths need remapping and browser dependencies need reinstalling for replay. This archive is local private evidence, not a public downloadable artifact.

No new paid run is required to review these findings. Before a new release checkpoint, fix or explicitly resolve the acceptance, quality, flaky-test and superseded-state gaps, freeze the graders and seed, then collect fresh source-cohorted evidence under the [release procedure](../../RELEASING.md).
