# Investigation: refresh website and docs, and document artifacts, evidence, providers, and human approval

Date: 2026-08-10 · Repo at `3.2.8` · No product edits made.

## Question

Bring `website/` and the human-facing docs up to date, and add coverage for four
topics that are currently thin or absent: the artifacts the system produces,
evidence, evidence providers, and how human approval is handled.

## Facts

Verified against runtime code, `protocol.json`, `VERSION`, and disk. Line
references are current as of this note.

### The repository maintains two doc tiers with different update discipline

| Tier | Files | Shipped to consumers | State |
|---|---|---|---|
| Agent-facing | `WORKFLOW.md`, `.claude/harness/EVIDENCE.md`, `.claude/orchestrator.md`, `.claude/harness/README.md` | yes | current; updated in the same commits as behavior through 3.2.8 |
| Human-facing | `README.md`, `README.th.md`, `website/index.html`, `website/docs/**` (12 EN + 12 TH pages) | no | untouched since 2026-08-06/07; four to five releases behind |

### Verified stale or wrong claims

**A shipped doc is factually wrong.** `.claude/harness/README.md:288` states
"Four adapters are available" and its table omits `contract-digest`.
`EVIDENCE.md:136`, `foundation.mjs:94-96`, and `website/docs/.../evidence/adapters.md:34`
all document five. This file installs into every consumer repository.

**The website's version pins are wrong in six places.** Ground truth is
`VERSION` = `3.2.8`, `protocol.json` `runtime` = `2.8.0`, `runtimeApi` = `17`.
`providerProtocol` = `7` is correctly stated everywhere.

| Location | Says | Truth |
|---|---|---|
| `website/index.html:84` | `API 14` | `17` |
| `website/index.html:528` | `v3.2.4 · runtime API 14` | `3.2.8` · API `17` |
| `website/docs/src/content/docs/index.md:52` | `v3.2.4 — runtime API 14` | `3.2.8` · API `17` |
| `website/docs/src/content/docs/cli.md:96,98` | `Pin v3.2.4`, `runtime 2.7.0` | `3.2.8`, `2.8.0` |
| `website/docs/src/content/docs/th/index.md:52` | same as EN | same fix |
| `website/docs/src/content/docs/th/cli.md:96,98` | same as EN | same fix |

`index.md:52` compounds the error: it tells readers that receipts from earlier
versions read as `provider-version-stale`, so a wrong pin there actively
misleads about re-proving.

**No document lists the real `.foundation/` tree.** Disk carries 13
directories: `attestations, authority, evidence, instruction-manifests, leases,
logs, plans, receipts, recovery, runtime, sandboxes, snapshots, transactions`
(plus `repository-sandboxes/`, `prototypes/`, and `policy.json` created
conditionally). Four listings exist and each is a different partial subset:

- `WORKFLOW.md:570-590` — 7 entries; omits `evidence/`, the immutable proof
  vault, which is arguably the most important artifact the system writes.
- `website/docs/.../loop.md:72-79` — the only listing with `authority/`,
  `transactions/`, `recovery/`; omits `evidence/` and `snapshots/`.
- `.claude/harness/README.md:320-327` — 6 of 13.
- `README.md:546-561` — omits seven.

### Coverage against the four requested topics

**Artifacts — light and scattered.** No canonical enumeration exists. Change
packets have zero human-facing explanation (`README.md` names `packet` only
inside an operator command list). Investigation notes are effectively
undocumented — one clause at `WORKFLOW.md:29` and one website mention; no doc
says where a note is written, its format, or whether it can be cited.
Telemetry is nearly absent from the website. `install-manifest.txt` and
`.foundation/prototypes/` are never named in `README.md`.

**Evidence — deep on the website, gapped in the READMEs.** The site's
`#evidence` section and `website/docs/.../evidence/claims.md` are the
best-written material in the repo. But `README.md:425-428` lists 15 of the 19
capabilities (omits `mutation` and `state-identity`), never introduces the four
statuses (`pass`/`fail`/`inconclusive`/`error`) even though `inconclusive` is
the one that most often blocks a user, and omits the v3.2.5 manual-vs-harness
execution floor entirely. The v3.2.8 multi-repo `discoveryProvider` rules exist
in exactly one file, `EVIDENCE.md:139-169`.

**Providers — best-covered topic, with one hard error.** Beyond the
`contract-digest` omission above, `README.md` never lists the adapters at all,
and the sandbox services/ports/isolation hazard (`EVIDENCE.md:293-327` — a
leftover server satisfies the first readiness poll and hands you a green suite)
appears in no human-facing doc.

**Human approval — the largest gap, and the runtime is subtler than any doc
suggests.** The code distinguishes four boundaries that the docs routinely
conflate:

1. **`acceptance`** — a named human approves the outcome. `external` adapter
   only. Standard changes start `decision: "undecided"`
   (`change-lifecycle.mjs:156`) and **`change validate` fails until a human
   decides** (`change-validation.mjs:235-236`). Re-validated on every read
   against the workspace hash, the scoped claims, and the contract reason, so
   any drift flips it to `acceptance-invalid`.
2. **`review`** — independent review, human *or* a different AI. Independence
   is never waivable; diversity relaxes to `preferred` only via
   `foundation.json` `review.diversity: "single-model"`, which surfaces a
   visible `diversity-waived-single-model` trigger. A third consecutive AI
   round is refused and escalated to human review
   (`review-attempt-store.mjs:112-135`), backed by a SHA-256 hash-chained
   attempt ledger that fails closed.
3. **The authority bridge** — `authority request` → `authority status
   --template` → `authority record` is how a verdict physically becomes a
   receipt. Requests are workspace-hash-bound, expire in 24h, are single-use,
   and restore the prior receipt if the recorded response would not validate.
4. **Host attestation** — `sandbox challenge` plus `doctor --unattended
   --attestation` is *not* human approval. It is an Ed25519 statement from a
   root-owned trusted host that the sandbox boundary is safe, with a 10-minute
   nonce and a replay guard.

`README.md` mentions `acceptance` exactly once, `attestation` twice, and
`contract-digest` never. `sandbox challenge` appears nowhere on the website.
`--decision-ref` appears twice in `README.md`'s command block with no
definition.

### Root cause of the drift

`.claude/tests/docs/run-doc-consistency.sh` asserts `WORKFLOW.md` contains
`Version <VERSION>`. That single assertion is why `WORKFLOW.md` is the only
document still correct at 3.2.8. `README.md`, `README.th.md`, and everything
under `website/` carry no equivalent guard, and every one of them drifted. The
website's only two assertions
(`run-context-budget-tests.sh:132-138`) check `proof run` vs `proof execute`
and say nothing about versions.

This is well-supported rather than certain: it explains the observed split
exactly, but I did not check whether release procedure ever called for manual
website updates. `RELEASING.md` was not read.

## Lanes

The work spans two lanes with different gates, per `CLAUDE.md`:

- **Instruction lane** (shipped): `.claude/harness/README.md`, `WORKFLOW.md`.
  Gates: context budgets, doc consistency, `commands.json`.
- **Repo-only lane**: `website/**`, `README.md`, `README.th.md`, `docs/`.
  Gate: `run-all.sh`.

## Options

**A — one change covering everything.** Correctness fixes, four new topic
areas, EN and TH, plus the anti-drift guard.
*For:* single coherent docs pass; one review.
*Against:* a factually wrong shipped file waits behind a large authoring
effort; the diff spans both lanes and is hard to review.

**B — two changes (recommended).**
1. *Correctness and anti-drift.* Fix the `contract-digest` omission, the six
   version pins, and the `.foundation/` listings; extend
   `run-doc-consistency.sh` so version-bearing human docs are asserted the way
   `WORKFLOW.md` already is. Small, high urgency, mostly mechanical.
2. *Topical coverage.* Author the artifacts / evidence / providers / human
   approval material against the fact base in this note.

*For:* the wrong shipped doc lands fast; the guard exists before the new prose
is written, so the new material cannot rot the same way; each change sits
mostly in one lane.
*Against:* two loop passes.

**C — three changes**, splitting TH parity into its own pass.
*For:* smallest individual diffs.
*Against:* deliberately creates a window where EN and TH disagree, which is the
staleness class we are trying to remove.

## Decision

**Option A — one change covering everything.** Chosen by the user on
2026-08-10, over this note's recommendation of B. Recorded here rather than
left in chat.

The analysis behind B still stands and becomes sequencing guidance inside the
single change rather than a reason to split it:

- Land the `contract-digest` correction and the six version pins **first** in
  the task ledger. They are the only claims that are wrong rather than
  incomplete, and one of them ships to consumers on every install.
- Add the anti-drift assertion to `run-doc-consistency.sh` **before** authoring
  the new prose, so the new material is written under the guard that would have
  prevented this drift in the first place.
- Keep TH in step with EN task by task. `run-doc-consistency.sh` already
  asserts a Thai README string, so TH is a first-class surface today.

Because one change now spans both lanes, it must satisfy both gate sets: the
Instruction gates (context budgets, doc consistency, `commands.json`) for
`.claude/harness/README.md` and `WORKFLOW.md`, and `run-all.sh` for the
repo-only surfaces. Expect this to resolve above `impact: low`, which upgrades
a rapid change to standard and forces an explicit acceptance decision.

Highest-value new material: a single canonical `.foundation/` and change-packet
artifact table that the four existing partial listings can point at, and a
human-facing acceptance/approval section. The `undecided` blocks `change
validate` rule is a hard, user-visible blocker documented today only in
`WORKFLOW.md` and one website page.

## Constraint for the authoring pass

Do not overclaim the approval story. `land archive` is registered
`kind: "authority"` and `.claude/commands/land.md` instructs the agent to
explain effects and offer inspect/proceed/pause — but the harness gates Land on
*evidence*, not on consent. The only Land-path flags demanding a recorded human
decision are `land record --decision-ref`, `budget continue --decision-ref`,
`change abandon --decision-ref`, and `agents release --force --decision-ref`.
New public docs must describe this accurately rather than implying the runtime
blocks a land on human sign-off.

## Unknowns

- No runtime gate keying off `commands.json` `kind: "authority"` was found. It
  validates as a registry enum (`foundation.mjs:321`) and is consumed by a docs
  test. Whether a host or hook layer enforces it is unresolved, and it should
  be settled before any doc describes `kind: "authority"` as a control.
- Whether `openspec/investigations/` is intended to be tracked. The directory
  did not exist before this note.
- `docs/adr/` is referenced by `CLAUDE.md`'s gitignore policy but does not
  exist.
- Whether the website docs pages have a review or translation owner who should
  see the TH diff.

ready for /change
