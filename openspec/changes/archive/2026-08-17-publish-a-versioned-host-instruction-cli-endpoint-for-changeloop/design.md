# Design

## Current state

- `cli.sh` is the installed public router. Most workflow operations resolve a
  project runtime, while `version`, `help`, and `init` can run from the package
  without a project.
- Canonical host instructions ship under `.claude/commands`. The command
  registry already parses their frontmatter for `describe`, but only through a
  project runtime and does not expose their bodies as a contract.
- Homebrew installs `cli.sh` and the complete `.claude` tree together under
  `libexec`, so the package-relative command source is available without
  reading a consumer project.

## Decisions

- **Decision:** Add
  `claude-foundation host instruction COMMAND --protocol 1 --format json --arguments ARGUMENTS`
  as a synchronous, read-only package command routed before project discovery.
  - **Why:** a host needs the instruction to construct its next model request;
    package-relative resolution makes the installed release the sole owner.
  - **Rejected:** project command files, `describe` prose parsing, a network
    service, and mutating workflow execution inside the endpoint.
- **Decision:** Allow-list exactly `investigate`, `change`, `build`, `prove`,
  `land`, `changes`, `feature`, and `dev`; map each name internally to its
  package-owned command file. No caller-provided path reaches the filesystem.
  - **Why:** command identity is finite and public, while arbitrary paths would
    create traversal and disclosure risk.
- **Decision:** Protocol 1 emits one JSON object with `protocol`, `command`,
  `description`, `instruction`, `argumentMode`, and `foundationVersion`.
  Instructions exclude frontmatter. Commands with an argument hint render the
  literal `$ARGUMENTS` placeholder using the opaque argument value; `changes`
  rejects non-empty arguments.
  - **Why:** the response is self-describing, additive, and ready for direct
    host consumption without parsing Markdown metadata.
- **Decision:** Unknown response fields are additive. Unsupported protocol,
  unknown command, unexpected arguments, and unavailable instruction return a
  non-zero exit with JSON carrying stable codes `unsupported_protocol`,
  `unknown_host_command`, `unexpected_arguments`, and
  `instruction_unavailable`.
  - **Why:** consumers must branch on stable data rather than stderr prose or
    semantic-version equality.
- **Decision:** Put the pure loader/renderer beside runtime core contracts and
  keep `cli.sh` as the thin argv router. Register the public command in
  `commands.json`; do not bump runtime API 21 because the endpoint does not
  change the project-runtime interface.
  - **Why:** this preserves composition boundaries and avoids forcing consumer
    project upgrades for a package-only host capability.

## Compatibility and rollout

The endpoint is additive. Existing clients and project runtimes continue to
work unchanged. Release Foundation first; Changeloop may adopt protocol 1 only
after the released executable contains the endpoint. Consumers ignore unknown
response fields and do not require semantic-version equality.

Rollback removes only the additive endpoint. Existing Foundation workflow
state is untouched; a Changeloop consumer depending on protocol 1 will fail
closed and request a compatible CLI rather than switching instruction sources.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Caller selects an arbitrary file | Exact command allow-list and internal mapping | test |
| Arguments are evaluated as shell or corrupt JSON | Keep argv values opaque and serialize only with JSON.stringify | test |
| Package invocation accidentally requires a project | Contract test runs from a directory without Foundation markers | test |
| Command body and metadata drift | Read the shipped command file at request time and test all eight mappings | test |
| Public help advertises a dead route | Registry-to-router and `--help` contract tests | test |
