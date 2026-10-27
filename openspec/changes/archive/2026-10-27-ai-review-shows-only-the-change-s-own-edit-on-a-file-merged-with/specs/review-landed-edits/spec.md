# review-landed-edits

## Purpose

AI review shows only the change's own edit on a file merged with landed work.

## ADDED Requirements

### Requirement: review-diff-excludes-landed

The AI review diff SHALL compare a file that sync merged with an earlier change's landed edit against the landed bytes instead of the base in every review round

#### Scenario: A merged file shows only this change's lines

- **GIVEN** Change alpha landed an uncommitted edit at line 5 of backend/shared.txt and bravo's sandbox file holds that edit plus bravo's own edit at line 25, recorded by sandbox sync
- **WHEN** the review diff is built for bravo
- **THEN** the file's hunk contains bravo's line 25 and not alpha's line 5
- **AND** the file entry says it was compared against the landed bytes

#### Scenario: A correction round keeps the landed comparison

- **GIVEN** bravo's first review round compared backend/shared.txt against the landed bytes and a correction round reviews that file again
- **WHEN** the correction round's review inspection is built
- **THEN** it carries the same landed comparison for backend/shared.txt as the first round

#### Scenario: A file no earlier change landed keeps the base diff

- **GIVEN** bravo edited backend/other.txt and no earlier change landed it
- **WHEN** the review diff is built for bravo
- **THEN** the hunk shows every line bravo changed against the base

#### Scenario: Landed bytes that no longer match fall back to the base diff

- **GIVEN** sync recorded a merge of alpha's landed edit and the target file was edited afterwards so it no longer holds the recorded bytes
- **WHEN** the review diff is built for bravo
- **THEN** the hunk is the diff against the base and hides nothing from the reviewer

#### Scenario: A file equal to the landed bytes has no change of its own

- **GIVEN** bravo's sandbox file is byte-identical to the landed target file
- **WHEN** the review diff is built for bravo
- **THEN** the entry reports that the file is unchanged

### Requirement: root-landed-sync-record

Sandbox sync SHALL record for the root workspace, as for each repository, the target and sandbox bytes it left behind for every landed file

#### Scenario: The root sync records the merged file

- **GIVEN** alpha landed an edit to src/shared.txt and bravo's sandbox edited another line of it
- **WHEN** sandbox sync runs for bravo
- **THEN** bravo's runtime record holds the target and sandbox bytes for src/shared.txt
