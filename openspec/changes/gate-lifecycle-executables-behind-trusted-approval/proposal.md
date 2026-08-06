# Change: gate lifecycle executables behind trusted approval

## Why

A repository is untrusted content, but `.changeloop/proof-providers.json` and
`.changeloop/reviewer.json` currently choose the executable and argv that
`prove`, repair, and `review` spawn. Cloning a repository and running
`cloop prove` therefore runs that repository's chosen program on the operator's
machine with full host filesystem and network authority. The shared runner
clears the environment, which is not a substitute for deciding *whether the
program may run at all*.

The same file also supplies authority the harness then trusts: the reviewer
process self-reports `reviewerModelFamily` on stdout, and that value is what
`HarnessError::ReviewModelFamilyNotIndependent` checks. A reviewer can declare
any family and defeat the independence gate it is subject to.

## What changes

- Every repository-configured lifecycle executable — proof provider commands,
  their configured repair commands, and the independent reviewer — requires a
  content-bound approval recorded in the operator's trusted configuration
  directory before it is spawned, on both the CLI and app-server surfaces.
- An approval is bound to the resolved executable path **and its bytes**, the
  ordered argv, the environment passed, the timeout and output caps, the source
  config file digest, and the canonical project root. Changing any of them voids
  it. Repository content can never mint an approval.
- Without an approval, `prove`/`review` refuse with exit code 3 and print the
  exact grant command; they do not spawn.
- The reviewer's model family comes from the approval record, not from reviewer
  stdout. A reviewer that reports a different family is rejected.
- New `cloop approve list|grant|revoke` surface. `grant` re-derives the request
  from current on-disk config, displays it in full, and records exactly one
  digest — there is no wildcard and no standing grant for a class of programs.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code, CLI contract, app-server RPC, operator config data
- **Security triggers:** untrusted input reaching an exec sink; authority derived
  from untrusted process output

## Non-goals

- Enforcing OS sandbox isolation on lifecycle executors. The runner already
  spawns through `changeloop-sandbox` but declines enforcement under the
  enumerated `LIFECYCLE_OPERATOR_PROCESS` row, because proof commands routinely
  resolve dependencies over the network and write outside the workspace.
  Narrowing that row needs its own change with provider-breakage coverage.
- Authenticated/MAC-bound evidence storage for `.changeloop` operational state.
- Any change to which claims a provider may assert or to Land's own gates.
