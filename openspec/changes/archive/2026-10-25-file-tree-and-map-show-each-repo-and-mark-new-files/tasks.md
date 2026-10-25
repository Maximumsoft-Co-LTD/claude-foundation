# Tasks

> This is the sole implementation ledger.

- [x] **T001** Tree, file map, and addition detection are repository-aware with regression tests [key:repo-aware-tree] [kind:implementation] [paths:.claude/harness/runtime/workflow/validation/dev-document.mjs,.claude/harness/runtime/workflow/validation/design-blueprints.mjs,.claude/harness/runtime/workflow/change-lifecycle.mjs,.claude/harness/tests/design-blueprints.test.mjs] [claims:file-tree-per-repository-the-file-tree-and-derived-file-map-rend,file-tree-per-repository-the-file-tree-renders,file-tree-per-repository-the-file-tree-and-file-map-render,new-files-in-other-repositories-a-task-bound-to-api-lists-that-p,new-files-in-other-repositories-a-task-bound-to-api-lists-that-2,new-files-in-other-repositories-the-paths-are-checked-for-existe] — verify: `node --test .claude/harness/tests/design-blueprints.test.mjs .claude/harness/tests/change-draft-materialization.test.mjs`
- [x] **T002** WORKFLOW.md states the per-repository file tree and map [key:document-contract] [kind:implementation] [paths:WORKFLOW.md] [depends:T001] [claims:file-map-docs] — verify: `bash .claude/tests/docs/run-doc-consistency.sh`
