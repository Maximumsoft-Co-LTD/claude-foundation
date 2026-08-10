# Harness development playbook

How to change `claude-foundation` itself. This is the maintainer procedure that
sits above `CLAUDE.md` (what the repo is) and `WORKFLOW.md` (what the product
does for consumers).

Two facts drive everything below:

1. **Every shipped edit lands in someone else's repository.** `install.sh`
   overwrites `MANAGED` paths on every install and Homebrew `--HEAD` tracks
   `main`. There is no staging environment between a merge and a user.
2. **We dogfood the loop we ship.** Work here goes through
   `/change → /build → /prove → /land` like any other project. The harness is
   both the tool and the subject.

---

## 1. Triage: pick the lane first

Before writing anything, decide which lane the work is in. The lane determines
the gates, not the size of the diff.

| Lane | Touches | Consumer impact | Gate weight |
|---|---|---|---|
| **A — Runtime** | `.claude/harness/foundation.mjs`, `.claude/harness/runtime/**` | Behavior change in every install | Heaviest: wiring, protocol pins, regression at the seam |
| **B — Instruction** | `.claude/orchestrator.md`, `commands/`, `rules/`, `skills/`, `hooks/`, `WORKFLOW.md` | Changes what agents are told | Context budgets + doc consistency + registry |
| **C — Shipping boundary** | `install.sh`, `install-cursor.sh`, `commands.json`, `openspec/schemas/`, `protocol.json` | Changes what gets copied and how upgrades behave | Installer smoke + upgrade compatibility |
| **D — Repo-only** | `.claude/tests/**`, `dashboard/`, `website/`, `examples/`, `docs/` | None | `run-all.sh` only |
| **E — Release** | `VERSION`, `CHANGELOG.md`, `Formula/`, `.github/workflows/` | Distribution | `RELEASING.md`, rehearse with `dry_run` |

`cli.sh` is repo-only in file terms but is the **public control surface** users
type. Treat a change to its command grammar as Lane B/C, not Lane D.

A change may span lanes. Then it inherits the union of the gates — that is
usually the signal to slice it, not to widen it.

---

## 2. Standing rules

These hold in every lane and are not restated per step.

- **Traceability.** Every changed line traces to the request. Do not bundle
  cleanup, renames, or drive-by fixes into a behavioral change.
- **Skills before code.** Load one primary construction skill for the hardest
  decision (`.claude/rules/fundamentals.md` routes). Do not preload bodies.
- **LSP before grep.** Definitions, references, and diagnostics come from the
  LSP tool; grep is the fallback, not the default.
- **Shipped files carry rules, not narrative.** No benchmark numbers, cost
  figures, incident stories, or maintainer history in `.claude/**` or
  `WORKFLOW.md`. Evidence goes to `.claude/tests/bench/rationale.md`; durable
  findings go to `docs/reports/`.
- **A shipped file never points at a non-shipped path.** A consumer's install
  does not contain `.claude/tests/`, `docs/`, or `dashboard/`.
- **Read narrow.** `WORKFLOW.md` (~28K), `CHANGELOG.md` (~307K),
  `README.th.md` (~41K), and `harness/README.md` (~27K) are read by section.
- **A shipped-rule change also updates its deterministic test**, and, when the
  rule was evidence-driven, the benchmark rationale.

---

## 2.5 The self-hosting boundary

We use the loop to build the loop. That is only sound because the
self-reference is cut in three places — know where, so you know when it stops
holding.

**Why it is safe by construction:**

1. **The control plane is not the code under change.** `find_project_root`
   deliberately walks *past* a sandbox copy (`cli.sh`) and resolves to the
   project root. A runtime edit made inside a Build sandbox therefore does not
   execute the commands proving it; the root keeps running the last landed
   revision until Land applies the diff.
2. **The evidence base sits outside the loop.** `sh .claude/tests/run-all.sh`
   is plain shell and Node with no lifecycle state, and `harness-fixture.sh`
   installs from `git archive HEAD` when the tree is clean — so proof runs
   against a consistent snapshot, not against whatever is half-typed.
3. **Mismatch fails closed.** `cli.sh` compares `EXPECTED_RUNTIME_API` against
   `node foundation.mjs api-version`: write commands abort, read commands only
   warn. A half-migrated runtime can still be inspected but cannot mutate state.

**Where the loop is the wrong tool:**

- **Lane E (release).** `release.yml` is the procedure; there is no consumer
  behavior to claim.
- **Trivial Lane D edits** — a test comment, a `docs/reports/` note.
  `run-all.sh` is the gate.
- **Bootstrap-breaking edits.** Any change to the four runtime-API pins, to
  `foundation.mjs`'s load-time checks, or to `install.sh`'s `MANAGED` can leave
  the loop unable to run the very commands that would prove the fix. Make those
  at the root, verify with `run-all.sh` directly, then record the result back
  into the packet — do not expect the loop to prove its own repair mid-break.

**The line that must not be crossed:** harness evidence must never be produced
by invoking `claude-foundation`. Point providers at the deterministic suites.
The moment proof depends on the runtime under change, a defect that makes proof
pass wrongly also manufactures the evidence that it is not a defect.

---

## 3. The loop, concretely

### 3.1 `/change` — write the agreement

Produce `openspec/changes/<id>/` with the packet shape the archive already uses:
`proposal.md`, `tasks.md`, `evidence.yaml`, `execution.yaml`,
`repositories.yaml`, plus `design.md` + `specs/` on the standard schema.

Rules that matter here more than anywhere else:

- **Intent is one imperative sentence** naming the observable outcome. The
  change id is derived from it and becomes a directory name people read for
  months — `name the registered command when a two-word CLI form reaches the
  runtime entrypoint` is the register.
- **`proposal.md` states the dead end, not the diff.** `## Why` explains what a
  reader is told today and why it cannot be acted on. `## Non-goals` is where a
  reviewer learns which adjacent fix you deliberately refused.
- **Claims are scenarios, not tasks.** One claim per independently observable
  behavior, phrased as what happens, including the negative path:

  ```json
  { "id": "an-unknown-command-invents-no-internal-name",
    "scenario": "A command that is not part of any public two-word form still fails in one plain line and suggests no internal name.",
    "impact": "low", "capabilities": ["test"] }
  ```

- **Declare the surface early**: `change resolve --surface '<glob>,<glob>'`.
  The forecast warns only — enforcement stays on the real changed surface — but
  it is how you find out at Change time that you are about to owe compatibility
  or migration evidence.
- **Record the acceptance decision.** A standard change stays unvalidatable
  while acceptance is `undecided`. Harness work is almost always
  `--acceptance-not-required`; say so explicitly.
- **Run `doctor --stage change`** before moving on.

Use `/investigate` first only when the direction is genuinely unresolved, and
`/investigate <decision> --compare` only for real alternatives — its output
lives under `.foundation/prototypes/` and is never evidence.

### 3.2 `/build` — implement in isolation

```bash
claude-foundation sandbox create <change>
```

- `tasks.md` is the **sole** ledger. Each task carries its file, its verify
  command, and `[claims:…] [repo:…] [paths:…]`. Dispatch is denied for a task
  claiming behavior outside its repository authority or with no provider.
- If the agreement changes mid-build, revise the OpenSpec change and
  `sandbox sync <change>` — do not let the sandbox and the packet drift. Sync
  bumps the revision and invalidates proof, which is the correct cost.
- Packet artifacts are edited in the **target**, not the sandbox; only
  `tasks.md` ticks merge back.

### 3.3 `/prove` — bind evidence to the workspace

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

For harness work the provider is almost always the deterministic suite. See §4.

A non-ready state is a routed decision, never a dead end: `NEEDS_CODE_CHANGE`
→ back to Build; `CONFIGURATION_ERROR` → doctor + `/change`;
`INFRASTRUCTURE_ERROR` → diagnose, retry, record external evidence, or
reconfigure an available command for the *same* claims. Recovery never narrows
claim coverage.

### 3.4 `/land` — apply, sync specs, archive

```bash
claude-foundation land check <change>
claude-foundation land archive <change>
```

Then, before handing off:

```bash
sh .claude/tests/run-all.sh     # Node >= 20.19; ends with `npm --prefix dashboard test`
```

Commit style follows the log: `type(scope): imperative summary` where the scope
is the subsystem (`fix(evidence):`, `test(land):`, `fix(harness):`,
`docs(changelog):`). Commit, push, and PR effects need explicit authorization —
they are not implied by a successful Land.

---

## 4. Evidence design for harness work

The deterministic suite **is** the product's proof. Design evidence around it
rather than inventing a parallel one.

**Place the regression at the lowest boundary that would have caught the
defect** (`.claude/tests/README.md` is authoritative):

- runtime or evidence semantics → `harness/run-harness-tests.sh`
- change-loop seams / CLI entrypoint → `harness/run-changeloop-seam-tests.sh`
- install, upgrade, CLI grammar → `harness/run-installer-tests.sh`
- shipped hook behavior → `hooks/run-hook-tests.sh`
- instruction file size and vocabulary → `harness/run-context-budget-tests.sh`
- shipped documentation contracts → `docs/run-doc-consistency.sh`

**The two-file pattern.** Human-read suites print PASS/FAIL; evidence needs a
countable report. Pair the assertion suite with a thin TAP wrapper and give the
provider a floor:

```json
{ "version": 1,
  "providers": { "test": {
    "adapter": "test-discovery",
    "command": ["sh", ".claude/tests/harness/run-changeloop-seam-tap.sh"],
    "minimum": 100, "reportFormat": "tap" } },
  "services": {} }
```

`test` evidence automatically pulls in `discovery`, so a suite that silently
finds zero tests cannot pass.

**Adding a suite** means three edits, always together: the script, a `run` line
in `.claude/tests/run-all.sh`, and a row in `.claude/tests/README.md`. The
entrypoint is authoritative; the table follows it.

Historical fixtures under `bench/`, `docs/`, `interview/`, `ledger/`, and
`scenarios/` are research material — never package them as live hook
self-tests.

---

## 5. Lane checklists

### Lane A — Runtime

- [ ] New code lives inside a `runtime/` domain (`core`, `evidence`,
      `workflow`, `observability`, `reliability`, `contracts`).
      `foundation.mjs` stays a composition root.
- [ ] Dependency rules hold (`runtime/README.md`): no domain imports
      `foundation.mjs`, no domain mutates another's state, cross-domain
      behavior is injected as a callback, pure validation stays out of the
      filesystem/process adapters.
- [ ] `run-wiring-tests.sh` passes — every factory parameter supplied, no
      orphaned module.
- [ ] **Entrypoint ↔ runtime boundary changed shape?** Four pins must move
      together and are currently all `17`:
      `runtime/version.mjs RUNTIME_MODULE_API`,
      `foundation.mjs RUNTIME_API_VERSION` (compared at load — a mismatch is
      `BLOCKED` before any command runs), `protocol.json runtimeApi` (asserted
      by `docs/run-doc-consistency.sh`), and `cli.sh EXPECTED_RUNTIME_API`
      (a mismatch aborts every *write* command and warns on reads).
      Miss the `cli.sh` pin and the loop cannot run the commands that would
      prove the change — see § 2.5.
- [ ] **Wire-visible contract changed?** Bump the specific pin in
      `protocol.json` (`providerProtocol`, `packetSchema`, `reviewProtocol`, …)
      and keep `run-upgrade-compat-tests.sh` honest about the old shape.
- [ ] Quality invariants intact (`WORKFLOW.md` § Quality invariants): zero
      discovered tests cannot pass, stale proof cannot land, a sandbox diff
      cannot overwrite a conflicting target.

### Lane B — Instruction surface

- [ ] `run-context-budget-tests.sh` passes — always-on, orchestrator, command,
      agent-contract, plan-summary, and packet ceilings are hard limits.
- [ ] `docs/run-doc-consistency.sh` passes — shipped docs resolve only shipped
      paths.
- [ ] Canonical vocabulary only. Legacy names (`proof plan`, `runtime new`)
      still resolve but must not appear in any slash command or help text.
- [ ] New agent-facing command → entry in `.claude/harness/commands.json`
      (it drives `cli.sh help`), and consider a `grep -F` assertion in
      `.github/workflows/workflow-tests.yml`.
- [ ] Non-lifecycle skills (`brainstorming`, `plan-writing`, frontend/UX,
      `skill-creator`) trigger from their own descriptions — never added to the
      always-on router just to be discoverable.
- [ ] Hook changes are wired in `.claude/settings.json` (or deliberately left
      unwired, like `no-direct-main-commit.sh`) and covered by
      `hooks/run-hook-tests.sh`.
- [ ] `WORKFLOW.md`'s `**Version X.Y.Z**` line still mirrors `VERSION`.

### Lane C — Shipping boundary

- [ ] `MANAGED` in `install.sh` is authoritative and updated. A path removed
      from `MANAGED` is only cleaned from a target if
      `.foundation/install-manifest.txt` previously claimed it — dropping a path
      without that history strands the file forever.
- [ ] Project-owned files stay project-owned: `.claude/settings.json` merged
      with `jq` + timestamped backup; `openspec/config.yaml`,
      `repositories.yaml`, `foundation.json` copied only when missing;
      `CLAUDE.md`/`AGENTS.md` rewritten only inside the marked pointer block.
- [ ] `run-installer-tests.sh` covers the upgrade path from the previous
      shape, not just a clean install.
- [ ] Schemas and command files are picked up automatically — but verify, don't
      assume.

### Lane D — Repo-only

- [ ] `sh .claude/tests/run-all.sh` still green, including
      `npm --prefix dashboard test`.
- [ ] Nothing under `.claude/tests/**`, `dashboard/**`, `website/**`,
      `examples/**`, or `docs/**` became a dependency of a shipped file.

### Lane E — Release

- [ ] `CHANGELOG.md` `## [Unreleased]` written by hand — this is the only
      hand-written part.
- [ ] `gh workflow run release.yml -f version=X.Y.Z` does the rest (version
      bump, `WORKFLOW.md` mirror, tag, formula `url`/`sha256`, GitHub release,
      bottle, `bottle do` block). Result: 2 bot commits + a tag.
- [ ] **Release machinery itself changed?** Rehearse with `-f dry_run=true`
      first.
- [ ] Bottle covers one pinned arm64 macOS runner; everything else builds from
      source. Widening coverage means one `sha256 … <tag>:` line per platform.
- [ ] Uploading a bottle by hand → rename `--` to `-` in the asset filename or
      `brew install` 404s.

---

## 6. What forces a version bump

| Change | Bump |
|---|---|
| Entrypoint ↔ `runtime/**` call shape | `RUNTIME_MODULE_API` + `RUNTIME_API_VERSION` + `protocol.json.runtimeApi` |
| Receipt/provider semantics | `providerProtocol` (invalidates old receipts by design) |
| Packet or plan wire shape | `packetSchema` / `agentPlanSchema` |
| Evidence or execution file shape | `evidenceSchema` / `executionSchema` (+ `evidence upgrade` path) |
| Review, acceptance, attestation, CI envelope | the matching `*Protocol` pin |
| Anything user-visible shipped | `CHANGELOG.md` under `## [Unreleased]` |
| Cutting a release | `VERSION` + `WORKFLOW.md` mirror (automated by `release.yml`) |

---

## 7. Repo hygiene

- **Start a change from a clean tree.** A target with uncommitted work falls
  back to an isolated copy instead of a git worktree. The harness tolerates its
  own leftovers (`.foundation/`, an uncommitted `openspec/changes/archive/`
  move), but unrelated dirt costs the next change its worktree.
- **Land, then commit, promptly.** Archived-but-uncommitted change directories
  accumulate as untracked `openspec/changes/archive/*` and make the next
  session's state read ambiguous.
- **Orphan runtime state** — runtime files whose OpenSpec directory is gone —
  is reported by `claude-foundation changes` as `orphan-runtime`, with
  `doctor --change <id>` naming how to restore or quarantine it. The
  `SessionStart` digest is deliberately hash-free: it names the next command
  but never claims proof is fresh. Only `/changes` answers readiness.
- **Retire, don't delete.** `change abandon <change> --reason <r>
  --decision-ref <ref>` releases leases, cleans the sandbox, and moves
  everything to `.foundation/recovery/abandoned/<id>/`. Deleting a change
  directory by hand leaves exactly the orphan state above.
- **Docs placement.** `/docs/*` is gitignored except an explicit allowlist plus
  `docs/reports/` and `docs/adr/`. Working notes stay under `docs/research/`
  (untracked); a durable finding gets committed to `docs/reports/`.

---

## 8. Stop signals

Treat any of these as a defect in the change, not a step to push through:

- `foundation.mjs` grew logic instead of wiring.
- A shipped file references `.claude/tests/`, `docs/`, or `dashboard/`.
- A new rule shipped without a deterministic test that fails when the rule is
  removed.
- A test was added at a higher boundary than the one that caught the defect
  (an e2e pinning a parser bug).
- The change bundles an unrelated cleanup "while we're here".
- A protocol pin moved without a compatibility test for the old shape.
- A slash command or help string uses legacy vocabulary.
- A guard was relaxed to make proof pass. Required assurance is never dropped
  for size, budget, or convenience — re-scope or retire the change instead.
- A non-lifecycle skill was added to the always-on router for discoverability.

---

## 9. Rhythm

- **Per change:** one lane, one agreement, one slice that can be proven. If the
  packet needs two unrelated `## Why` paragraphs, it is two changes.
- **Per batch:** land several changes, then cut one release. `CHANGELOG.md`
  `## [Unreleased]` accumulates between cuts; `release.yml` does the mechanics.
- **Per audit:** durable findings (bug sweeps, multi-repo audits, loop reviews)
  go to `docs/reports/` with the date in the filename, as the existing
  `bug-audit-2026-08-07.md` and `changeloop-review-2026-08-08.md` do. They are
  inputs to future changes, never a substitute for one.
