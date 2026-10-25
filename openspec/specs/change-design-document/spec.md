# change-design-document Specification

## Purpose
File tree and map show each repo and mark new files +.
## Requirements
### Requirement: file-tree-per-repository

The design document SHALL group the file tree and derived file map by repository

#### Scenario: Two repositories

- **GIVEN** Tasks bound to root and to repository api touch different paths
- **WHEN** The file tree and derived file map render
- **THEN** Each repository has its own titled tree and the file map rows carry a Repo column

#### Scenario: Same path in two repositories

- **GIVEN** Root and api both touch src/index.js
- **WHEN** The file tree renders
- **THEN** Both entries appear, one under each repository

#### Scenario: Single repository unchanged

- **GIVEN** No task names a repository
- **WHEN** The file tree and file map render
- **THEN** The output has no repository heading or Repo column and matches the previous output

### Requirement: new-files-in-other-repositories

The design document SHALL mark a path missing at its own repository's base as an addition

#### Scenario: New file in repository api

- **GIVEN** Repository api is resolvable and lacks service/new_test.go
- **WHEN** A task bound to api lists that path
- **THEN** The tree marks it + and the file map change is add

#### Scenario: Existing file in repository api

- **GIVEN** Repository api has service/old.go
- **WHEN** A task bound to api lists that path
- **THEN** The tree marks it ~

#### Scenario: Unresolvable repository root

- **GIVEN** The repository catalog has no root for the task's repository
- **WHEN** The paths are checked for existence
- **THEN** The paths stay ~ and compilation continues

### Requirement: file-map-docs

WORKFLOW.md SHALL state that the file tree and file map are grouped per repository

#### Scenario: Contract text

- **WHEN** WORKFLOW.md describes the File map
- **THEN** It names the per-repository tree, the Repo column, and the base-per-repository addition rule
