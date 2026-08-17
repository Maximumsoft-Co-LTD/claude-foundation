# Change: Publish a versioned host-instruction CLI endpoint

## Why

Host integrations can discover Foundation command metadata through `describe`,
but they cannot obtain the canonical instruction owned by the installed
Foundation release. Changeloop therefore has to read project files or bundle a
copy, making host behavior depend on project installation shape or stale
instructions.

## What changes

- Add a read-only `claude-foundation host instruction` command for the eight
  shipped Foundation workflow commands.
- Publish a protocol-1 JSON response containing validated command metadata and
  the rendered instruction from the installed release.
- Return stable machine error codes for invalid commands, protocol mismatch,
  argument mismatch, and unavailable source instructions.
- Make the endpoint independent of project-root and project-runtime discovery,
  then cover source-package and Homebrew-style invocation with deterministic
  contract tests.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** public CLI grammar, host integration contract,
  command source loading, help/registry, tests and public workflow docs
- **Security triggers:** untrusted command name and argument text at a local
  process boundary; file selection must be allow-listed and output JSON encoded

## Non-goals

- Execute a full Foundation workflow on behalf of a host.
- Read commands from the target project or require a Foundation project root.
- Interpret arguments as shell syntax or accept arbitrary instruction paths.
- Change lifecycle, evidence, review, acceptance, or Land semantics.
