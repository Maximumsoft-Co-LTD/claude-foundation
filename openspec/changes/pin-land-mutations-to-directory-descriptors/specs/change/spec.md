## ADDED Requirements

### Requirement: Land mutates through the directory it checked

The system SHALL resolve each Land entry's parent directory once into a held
directory descriptor and SHALL perform every subsequent check and mutation for
that entry through that descriptor.

#### Scenario: a re-pointed parent name does not redirect the write

- **WHEN** the name of an entry's parent directory is replaced after Land has
  resolved it
- **THEN** the write lands in the directory that was checked, and nothing is
  written through the replacement

#### Scenario: rollback restores through the same descriptor

- **WHEN** an applied entry is rolled back
- **THEN** the restore is performed through the descriptor the entry resolved,
  not by re-resolving the path

### Requirement: Symlinks on a Land path are refused, not traversed

The system SHALL refuse a Land entry whose parent components or leaf is a
symbolic link.

#### Scenario: a symlinked parent component is rejected

- **WHEN** a component of an entry's path is a symbolic link
- **THEN** resolution fails as an unsupported path and no descriptor is opened
  beyond it

#### Scenario: a symlinked leaf is neither read nor replaced

- **WHEN** an entry's leaf is a symbolic link
- **THEN** reading its identity and removing it both fail as unsupported, and
  the file the link pointed at is unchanged

### Requirement: An absent Land target is missing, not an error

The system SHALL report an absent leaf as missing and SHALL treat removing an
absent leaf as success.

#### Scenario: an absent leaf reports missing

- **WHEN** an entry's leaf does not exist
- **THEN** its identity is missing and removing it succeeds
