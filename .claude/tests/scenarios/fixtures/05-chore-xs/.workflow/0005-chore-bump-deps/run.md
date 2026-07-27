# Run: Bump build dependencies

**Type**: chore

## Goal

Bump the linter and test runner to their latest patch releases and confirm the existing suite still passes unchanged.

## Acceptance

- [x] **AC1** — **Given** the current lockfile, **When** the dependencies are bumped, **Then** the pinned versions update and the existing suite passes with no source changes.

## Tasks

- [x] T001 [AC1] Bump the linter and test runner to their latest patch — verify: `npm test` passes and the lockfile diff is versions-only.

## Rollback

Restore the previous lockfile.
