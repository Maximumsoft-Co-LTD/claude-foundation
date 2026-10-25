# Design

## Work type

bugfix, docs

## Bugfix analysis

| Part | Detail |
|---|---|
| Reproduction | Draft two tasks, one with repository api and a new file path; the tree merges both repos and marks the new file ~ |
| Root cause | withNewPaths skips every task with a repository and the tree and file map key only on path |
| Regression proof | A test builds a two-repo draft and asserts per-repo trees, + for the new file, and ~ when the root is unknown |

## Failure matrix

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| Unresolvable repository root | The paths stay ~ and compilation continues | None needed; the approver sees a change mark, never a false addition | new-files-in-other-repositories |

## File map

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/validation/dev-document.mjs`, `.claude/harness/runtime/workflow/validation/design-blueprints.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/design-blueprints.test.mjs` |
| T002 | `WORKFLOW.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── runtime/
│       │   └── workflow/
│       │       ├── ~ change-lifecycle.mjs
│       │       └── validation/
│       │           ├── ~ design-blueprints.mjs
│       │           └── ~ dev-document.mjs
│       └── tests/
│           └── ~ design-blueprints.test.mjs
└── ~ WORKFLOW.md
```

## Test map

| Scenario | Level | Check | Task |
|---|---|---|---|
| Two repositories; Same path in two repositories; Single repository unchanged; New file in repository api; Existing file in repository api; Unresolvable repository root | task check | `node --test .claude/harness/tests/design-blueprints.test.mjs .claude/harness/tests/change-draft-materialization.test.mjs` | T001 |
| Contract text | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T002 |
