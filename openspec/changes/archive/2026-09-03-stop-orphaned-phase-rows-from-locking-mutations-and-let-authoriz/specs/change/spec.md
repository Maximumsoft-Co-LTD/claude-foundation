## ADDED Requirements

### Requirement: Recorded phase context ignores changes that are no longer active

The phase mutation guard SHALL derive its active phase only from a recorded
phase row whose change is still an active OpenSpec change. A row belonging to
a change with no `openspec/changes/<id>` directory SHALL be ignored, and the
newest remaining eligible row SHALL govern instead.

#### Scenario: An orphaned change's row does not govern the session

- **WHEN** the newest `phase-context.jsonl` row belongs to a change that has no
  `openspec/changes/<id>` directory, and an older fresh row belongs to an
  active change
- **THEN** the guard reports the active change's phase, not the orphaned one's

#### Scenario: Only orphaned rows leave no phase to enforce

- **WHEN** every fresh recorded phase row belongs to a change with no
  `openspec/changes/<id>` directory
- **THEN** the guard establishes no phase and does not block mutations in
  its default `auto` mode

#### Scenario: An active change's row still governs

- **WHEN** the newest fresh recorded phase row belongs to a change whose
  `openspec/changes/<id>` directory exists
- **THEN** the guard enforces that row's phase exactly as before

### Requirement: Land permits authorized delivery commands without the transaction marker

Land SHALL treat `git commit` and `git push` as delivery rather than tree
mutation and SHALL allow them without `FOUNDATION_LAND_TRANSACTION=1`. Every
other mutating shell command during Land SHALL still require that marker, and
the refusal SHALL name the operations it refused.

#### Scenario: An authorized delivery commit runs during Land

- **WHEN** a `git add … && git commit -m …` command is inspected during Land
  without the runtime transaction marker
- **THEN** the guard reports no violation

#### Scenario: A tree mutation during Land is still refused

- **WHEN** a `git checkout -- src`, `rm -rf build`, or `echo x > notes.txt`
  command is inspected during Land without the runtime transaction marker
- **THEN** the guard reports a violation that names the refused operation

#### Scenario: An opaque shell runner is not delivery

- **WHEN** a Land command wraps its work in `sh -c` or `bash <script>` without
  the runtime transaction marker
- **THEN** the guard refuses it, because its mutations cannot be read from the
  command text
