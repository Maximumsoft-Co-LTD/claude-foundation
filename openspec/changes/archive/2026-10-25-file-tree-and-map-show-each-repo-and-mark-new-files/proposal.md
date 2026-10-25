# Change: File tree and map show each repo and mark new files +

- **Change:** `file-tree-and-map-show-each-repo-and-mark-new-files` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-25

## Why

On multi-repository changes the approval page merges files from every repository into one tree with no repository name, and shows a new file in a non-root repository as a change (`~`) instead of an addition (`+`). Approvers cannot tell where a file lives or whether it already exists. The tree and file map should group by repository and mark additions correctly.

## Scope

- **In scope (`change-design-document`):** A reader sees which repository owns each touched path; New files in a non-root repository show + instead of ~; The canonical lifecycle contract matches the rendered design document
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/validation/dev-document.mjs`, `.claude/harness/runtime/workflow/validation/design-blueprints.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/design-blueprints.test.mjs`, `WORKFLOW.md`

## Impact and risk

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## Acceptance traceability

Tasks: `tasks.md`; scenarios: the specs.

| Requirement | Scenario | Kind | Task | Check | Decision |
|---|---|---|---|---|---|
| file-tree-per-repository | Two repositories | success | T001 | test: `.claude/harness/tests/design-blueprints.test.mjs` | — |
|  | Same path in two repositories | boundary | T001 |  |  |
|  | Single repository unchanged | boundary | T001 |  |  |
| new-files-in-other-repositories | New file in repository api | success | T001 | test: `.claude/harness/tests/design-blueprints.test.mjs` | — |
|  | Existing file in repository api | success | T001 |  |  |
|  | Unresolvable repository root | failure | T001 |  |  |
| file-map-docs | Contract text | success | T002 | test | — |

## Definition of done

- Fresh evidence for every claim (7).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Appendix: Derived by the harness

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Review record

| Round | Finding | Severity | Fix | Reviewer |
|---|---|---|---|---|
| 1 | No findings | — | — | claude-opus |
