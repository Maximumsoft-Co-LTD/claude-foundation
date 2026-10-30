# Prototype form by work type

The harness lists the surfaces a change owes in `prototype.checklist` (keys such
as `flow`, `states`, `api`, `ba`, `fail`). This file says what to draw for each
of the 26 catalog work types. When a change has several types, show the union
once, in the checklist's order. Every type also owes `ba` (before and after);
types that can fail also owe `fail` (failure cases with recovery).

Each entry: **Show** what the page must make visible, **Form** the shape that
suits it, **From** the draft fields to read. If a field is absent, write
`unknown` there.

## A: what users see

### feature
- **Show**: the user path end to end, with the failing path.
- **Form**: a clickable screen that steps through the flow.
- **From**: `userFlow`, `releaseNote`.

### ui
- **Show**: every state of every screen: loading, empty, error, success.
- **Form**: the real screens with a state switcher and keyboard focus.
- **From**: `uiStates`, `userFlow`, `componentMap`.

### client-release
- **Show**: what an old and a new app version each see; the release order.
- **Form**: a version switch plus a release timeline.
- **From**: `releasePlan`.

### experiment
- **Show**: what each group sees; the metrics and the stop criteria.
- **Form**: a group switch and a metrics table.
- **From**: `experimentDesign`.

## B: fixing a problem

### bugfix
- **Show**: the reported case and the boundaries beside it, before and after.
- **Form**: an input to result table, switchable between before and after.
- **From**: `bugfix` (security and hotfix add `disclosure` or `incident`), scenarios.

## C: no change in behavior

### refactor
- **Show**: structure before and after; what must stay the same.
- **Form**: a module map for each side and a table of unchanged behavior.
- **From**: `refactor`, `componentMap`.

### dependency
- **Show**: old to new versions; what must stay the same; supply-chain checks.
- **Form**: a package table; each check shows its real status or `unknown`.
- **From**: `dependencyChange`.

### config
- **Show**: old to new values; the effect on behavior; the undo.
- **Form**: a value table with an old and new switch.
- **From**: `configContract`.

### docs
- **Show**: the document before and after.
- **Form**: a side-by-side diff; no screens needed.
- **From**: `scratch`.

### test
- **Show**: what each new test checks and whether it can really fail.
- **Form**: a table of cases against the old and the intended code.
- **From**: `tasks` verify, scenarios.

### chore
- **Show**: what changes, before and after.
- **Form**: a before and after list of files or values.
- **From**: `scratch`.

## D: contracts with others

### api
- **Show**: request, response, and every error case; the user path.
- **Form**: an endpoint panel with a case selector; responses are fixtures from the draft.
- **From**: `apiContracts`, `boundaries`, `userFlow`.

### library
- **Show**: exports, signatures, semver, and a call before and after.
- **Form**: code samples switchable between before and after.
- **From**: `libraryContract`.

### deprecation
- **Show**: who uses it, the timeline, the migration path.
- **Form**: a timeline and a table of current users, with `unknown` for those not known.
- **From**: `deprecationPlan`.

## E: data

### data
- **Show**: tables and columns before and after, the migration, the rollback.
- **Form**: a schema panel with a before and after switch.
- **From**: `dataModel`.

### migration
- **Show**: before to after, the release order, parity, the rollback window.
- **Form**: a release timeline plus a schema panel.
- **From**: `migrationPlan`, `rollout`, `dataModel`.

### data-fix
- **Show**: sample rows before and after, how many rows, the undo.
- **Form**: a row table; the count and the backup reference stated plainly.
- **From**: `dataFix`.

## F: back end and structure

### async
- **Show**: job states, retry, timeout, idempotency.
- **Form**: a state diagram whose states can be selected.
- **From**: `jobContract`, `diagrams`.

### integration
- **Show**: the order of calls to the outside system; slow and failing replies.
- **Form**: a sequence with a normal, slow, and failing switch.
- **From**: `integrations`.

### infra
- **Show**: structure before and after, size, cost, rollback.
- **Form**: a topology diagram for each side and a cost row.
- **From**: `infraPlan`.

### observability
- **Show**: the signals added and what an operator sees when it breaks.
- **Form**: a normal view against a failing view of the log, metric, or alert.
- **From**: `observability`.

### performance
- **Show**: the numbers before and after, the target, how they were measured.
- **Form**: bars or a table; measurements the draft lacks stay `unknown`.
- **From**: `performanceAnalysis`, `nfr`.

### cicd
- **Show**: the pipeline before and after; the changed stage; what happens on failure.
- **Form**: a stage diagram with each stage's failure result.
- **From**: `pipelinePlan`.

## G: people and compliance

### privacy
- **Show**: whose data, how long it is kept, who sees it, and how it is erased.
- **Form**: a data table plus a retention timeline.
- **From**: `privacyAssessment`.

### ml
- **Show**: good and bad input to output examples, the bar, before and after.
- **Form**: a comparison table of real examples, including a wrong one.
- **From**: `modelCard`.

### security
- **Show**: who can and cannot do what before and after; attacks it stops.
- **Form**: a permission matrix and a table of blocked cases with their result.
- **From**: `threatModel`, `hardening`.
