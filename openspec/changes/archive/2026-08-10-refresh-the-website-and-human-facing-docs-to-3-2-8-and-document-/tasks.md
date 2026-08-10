# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

## Correct what is wrong

- [x] **T001** [claims:adapter-catalog-matches-runtime] Shipped operator documentation names every adapter the runtime implements, `contract-digest` included, and stops saying "Four adapters" — `.claude/harness/README.md` — verify: the adapter table has one row per entry in `ADAPTERS` in `.claude/harness/foundation.mjs`, and no count word contradicts it [repo:root] [paths:.claude/harness/README.md]

- [x] **T002** [claims:version-pins-track-the-release] Every human-facing surface states the release, runtime, and runtime API the repository carries — `website/index.html:84,528`, `website/docs/src/content/docs/{index.md,cli.md}` and their `th/` mirrors, plus a version line in `README.md` and `README.th.md` — verify: no surface names `3.2.4`, `2.7.0`, or runtime API `14`, and each states the values held by `VERSION` and `protocol.json` [repo:root] [paths:website/index.html,website/docs/src/content/docs/**,README.md,README.th.md]

- [x] **T003** [claims:version-pins-track-the-release,adapter-catalog-matches-runtime] The documentation suite derives the release, protocol pins, and adapter set from `VERSION`, `protocol.json`, and `foundation.mjs` at run time and fails when any documented surface drifts from them — `.claude/tests/docs/run-doc-consistency.sh` — verify: the suite passes now, and fails when a pin or an adapter row is edited to a wrong value [repo:root] [paths:.claude/tests/docs/**] [depends:T001,T002]

## Publish what is missing

- [x] **T004** [claims:foundation-artifact-listing-is-canonical] One canonical table describes the artifacts the system writes — the change packet, the `.foundation/` tree, receipts, the proof vault, prototypes, telemetry, and the install manifest — and `WORKFLOW.md`, `.claude/harness/README.md`, and `README.md` carry a short listing that names it as the source — new docs page in English and Thai — verify: every directory named in any listing is one the runtime declares in `foundation.mjs`, and no listing contradicts another [repo:root] [paths:website/docs/src/content/docs/**,WORKFLOW.md,.claude/harness/README.md,README.md]

- [x] **T005** [claims:approval-boundaries-documented-without-overclaim] A human-approval page distinguishes acceptance, independent review, the authority request and record bridge, and host attestation; states that a standard change starts `undecided` and fails `change validate` until a human decides; and says plainly that Land gates on evidence rather than consent — new docs page in English and Thai, with `README.md` and `README.th.md` pointing at it — verify: the page names all four boundaries and the `undecided` blocker, and no documentation surface states that Land requires human approval [repo:root] [paths:website/docs/src/content/docs/**,README.md,README.th.md]

- [x] **T006** [claims:docs-site-builds-with-paired-translations] Evidence and provider pages cover the four evidence statuses, the manual-versus-harness execution floor, content binding, all five adapters, `discoveryProvider`, and the sandbox service-isolation hazard, with `README.md` and `README.th.md` pointing at them — new docs pages in English and Thai — verify: `npm --prefix website/docs run build` succeeds and every English page has a Thai counterpart at the mirrored path [repo:root] [paths:website/docs/src/content/docs/**,README.md,README.th.md]

- [x] **T007** [claims:foundation-artifact-listing-is-canonical,approval-boundaries-documented-without-overclaim,docs-site-builds-with-paired-translations] The documentation suite asserts the new pages exist in both languages, carry the facts they were written to carry, and that no surface overclaims Land — `.claude/tests/docs/run-doc-consistency.sh` — verify: the suite passes, and fails when a new page is deleted, when its Thai counterpart is missing, or when a Land-consent claim is introduced [repo:root] [paths:.claude/tests/docs/**] [depends:T004,T005,T006]

## Make it provable and keep it that way

- [x] **T008** [claims:version-pins-track-the-release,adapter-catalog-matches-runtime,foundation-artifact-listing-is-canonical,approval-boundaries-documented-without-overclaim,docs-site-builds-with-paired-translations] A TAP view restates the documentation and context-budget suites as counted evidence, and `.claude/tests/README.md` gains its row — `.claude/tests/docs/run-docs-tap.sh` — verify: the wrapper emits a TAP plan of at least 110 assertions and exits non-zero when either wrapped suite fails [repo:root] [paths:.claude/tests/docs/**,.claude/tests/README.md] [depends:T003,T007]

- [x] **T009** [claims:landing-page-accessibility-unchanged] The landing-page edit stays confined to text nodes carrying version and protocol numbers — `website/index.html` — verify: `git diff website/index.html` changes no tag, attribute, ARIA role, or style declaration [repo:root] [paths:website/index.html] [depends:T002]
