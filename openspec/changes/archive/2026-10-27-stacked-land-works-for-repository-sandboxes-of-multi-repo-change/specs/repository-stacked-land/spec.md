# repository-stacked-land

## Purpose

Stacked Land works for repository sandboxes of multi-repo changes.

## ADDED Requirements

### Requirement: repository-landed-replay

Sandbox sync SHALL merge an earlier change's landed, uncommitted edit into the sandbox copy of a repository file that both changes edited

#### Scenario: Edits on different lines merge

- **GIVEN** Change alpha landed an uncommitted edit at line 5 of backend/shared.txt and change bravo edited line 25 of the same file in its backend sandbox
- **WHEN** sandbox sync runs for bravo
- **THEN** bravo's backend sandbox file holds both edits and sync reports the file as replayed for repository backend
- **AND** bravo's proof is invalidated so its evidence runs again

#### Scenario: Edits on the same line conflict

- **GIVEN** Both alpha's landed edit and bravo's sandbox edit rewrote line 10 of backend/shared.txt
- **WHEN** sandbox sync runs for bravo
- **THEN** sync reports a conflict that names repository backend, the path, and alpha as the landed change
- **AND** bravo's sandbox file is not written

#### Scenario: A file edited after the landing is not replayed

- **GIVEN** The target backend/shared.txt no longer holds the bytes alpha landed because someone edited it afterwards
- **WHEN** sandbox sync runs for bravo
- **THEN** the file is not replayed into the sandbox and Land's target-edit stop still applies to it

#### Scenario: A file the sandbox did not edit is left alone

- **GIVEN** alpha landed an edit to backend/other.txt and bravo's backend sandbox did not edit it
- **WHEN** sandbox sync runs for bravo
- **THEN** bravo's sandbox copy of backend/other.txt is unchanged

#### Scenario: A replayed change lands

- **GIVEN** A clean replay was recorded and bravo's evidence was refreshed
- **WHEN** advance runs for bravo through archived
- **THEN** bravo is archived and backend/shared.txt in the target holds both edits
- **AND** no repository HEAD moved

### Requirement: repository-resolution-accepted

Repository Land SHALL accept a sandbox file that keeps every landed edit outside the conflicting lines after a reported conflict was resolved in the sandbox

#### Scenario: A resolved merge lands

- **GIVEN** sync reported a same-line conflict for bravo and the agent edited backend/shared.txt in the sandbox into the merge of both edits
- **WHEN** advance runs for bravo through archived
- **THEN** Land applies the sandbox bytes to the target and bravo is archived with both edits present

#### Scenario: The agent decides the conflicting lines

- **GIVEN** sync reported a same-line conflict for bravo and the agent replaced the conflicting line with its own version while keeping every other landed edit
- **WHEN** advance runs for bravo through archived
- **THEN** Land applies the sandbox bytes and bravo is archived

#### Scenario: A merge that drops other landed edits does not land

- **GIVEN** alpha's landed edit also changed line 3 of backend/shared.txt, sync reported a same-line conflict at line 10, and the agent's edit restored line 3 to its base text
- **WHEN** advance runs for bravo through archived
- **THEN** Land stops naming repository backend and the path, and the target keeps alpha's landed bytes

#### Scenario: A resolution does not survive a changed target

- **GIVEN** A resolution was recorded for a file and the target file changed afterwards
- **WHEN** advance runs for bravo through archived
- **THEN** the recorded resolution no longer applies and Land stops on that file

### Requirement: repository-user-edit-stops

Repository Land SHALL stop on an uncommitted target edit that no earlier change landed and that the sandbox does not carry

#### Scenario: A user edit on the same lines stops Land

- **GIVEN** The target backend/shared.txt holds an uncommitted edit that no Land journal vouches for, and the sandbox rewrote the same line
- **WHEN** advance runs through archived
- **THEN** Land stops with the overwrite error naming repository backend and the path and the target bytes are unchanged

#### Scenario: A sandbox that already carries the edit lands

- **GIVEN** The target holds an uncommitted edit and the sandbox file already contains it and adds a distant edit
- **WHEN** advance runs through archived
- **THEN** Land applies the sandbox bytes without a stop
