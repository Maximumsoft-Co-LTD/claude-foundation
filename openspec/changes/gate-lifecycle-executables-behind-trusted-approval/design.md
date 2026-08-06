# Design

## Current state

- `changeloop-ops::run_lifecycle_process{,_cancellable}` is the one runner for
  proof, repair, and reviewer processes. It spawns through `changeloop-sandbox`
  but calls `.without_enforcement(exceptions::LIFECYCLE_OPERATOR_PROCESS)`, so
  the child holds host filesystem and network authority. It takes `command: &str`
  and `args: &[String]` and asks nothing about where they came from.
- CLI: `operational.rs::proof_providers` reads `.changeloop/proof-providers.json`
  into `ProofProviderConfig` and `reviewer_config` reads
  `.changeloop/reviewer.json`. Both feed `run_bounded_command` directly.
  `builtin_hardened_git` is `#[serde(skip)]`, so repository config already cannot
  impersonate the compiled-in provider — that half is sound and stays.
- App-server: `executable.rs` reads the same two files into `AppProofProvider` /
  `AppReviewerConfig` and calls `run_lifecycle_process_cancellable` directly.
- `CleanReviewResult.reviewer_model_family` is deserialized from reviewer stdout
  and is exactly the value `ConvergenceHarness::record_review` tests against
  `implementation_model_family` for `ReviewModelFamilyNotIndependent`.

## Decisions

- **Decision:** make the approval a *type* the runner demands, not a check the
  callers are asked to remember. `run_lifecycle_process` becomes private; the
  public entry takes `&ApprovedExecutor`, which only
  `executor_approval::authorize` can construct.
  - **Why:** the workspace already uses this shape — `changeloop-sandbox` keeps
    `raw` private and makes `ExceptionId` unconstructable outside the crate — so
    the compiler, not review, enforces that every lifecycle spawn passed the
    gate. Two surfaces call this runner today and more will.
  - **Rejected:** a `check_approved()` call at each call site. It is exactly the
    discipline that already failed here once.

- **Decision:** the approval digest binds the resolved executable path **and a
  digest of its bytes**, ordered argv, the environment names and values passed,
  timeout, output cap, config-file digest, and canonical root — but *not* the
  workspace revision.
  - **Why:** the workspace revision changes on every edit and `prove` runs after
    every edit. Binding to it would prompt on every run and train the operator to
    approve without reading, which is the documented failure mode this change
    exists to avoid. Executable bytes and config digest are what actually change
    when the attack happens.
  - **Rejected:** revision binding; and path-only binding, which a repository
    defeats by rewriting the file the path points at.

- **Decision:** approvals live in the operator's trusted configuration directory
  (`CHANGELOOP_CONFIG_HOME` → `XDG_CONFIG_HOME/changeloop` → platform config),
  file mode `0600`, never under `.changeloop/`.
  - **Why:** an approval stored inside the repository is forgeable by the
    repository, which is the whole premise being defended against.
  - **Rejected:** `.changeloop/approvals.json`.

- **Decision:** provenance must be `user` or `trusted-policy`. `grant`
  re-derives the request from current on-disk config and records that one
  digest; it never accepts a digest supplied on the command line.
  - **Why:** accepting a caller-supplied digest lets a repository print a
    convincing "run this to approve" string for content it does not have.
  - **Rejected:** `cloop approve add <digest>`.

- **Decision:** the reviewer's model family is recorded on the approval and is
  the value the harness sees. A reviewer whose stdout reports a different family
  is rejected as a reviewer contract violation.
  - **Why:** the independence gate must not read its input from the process it
    is gating.
  - **Rejected:** trusting stdout with a warning; a second config file inside the
    repository (same untrusted origin).

## Compatibility and migration

Breaking for any project that already configures a non-builtin proof provider or
a reviewer: the first `prove`/`review` after upgrade refuses with exit 3 and
prints the grant command. This is intended and is the point of the change. The
compiled-in `git-diff-check` default provider needs no approval, so a project
with no `.changeloop/proof-providers.json` is unaffected.

`ApprovedExecutor` is a new public type in `changeloop-ops`; the previous public
`run_lifecycle_process{,_cancellable}` signatures change. Both callers are in
this workspace.

The approval file is versioned (`version: 1`); an unknown version fails closed
rather than being ignored.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Operators habituate to granting without reading | `grant` prints resolved path, bytes digest, full argv, caps and config digest, and grants exactly one digest with no wildcard | test |
| A repository swaps the executable after approval | bytes digest is inside the approval digest; a rewritten binary voids it | test |
| A repository edits argv/config after approval | config-file digest and ordered argv are inside the approval digest | test |
| Reviewer lies about its model family | family comes from the approval; mismatch with stdout is rejected | test |
| A future call site spawns a lifecycle process ungated | raw runner is private; public entry requires `ApprovedExecutor` | test |
| Approval store itself is tampered with | stored outside the repository, `0600`, versioned, fails closed on unknown version | test |
