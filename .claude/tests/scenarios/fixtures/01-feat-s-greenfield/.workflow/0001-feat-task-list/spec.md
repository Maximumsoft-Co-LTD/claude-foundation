# Spec: Task list app

**ID**: 0001-feat-task-list
**Type**: feat
**Status**: approved
**Ship as**: one-drop
**Field**: greenfield

## Goal

Ship a single-page task list so a user can capture items and mark them complete in the browser.

## User Stories

### US1 — Add and complete items (Priority: P1)

A user adds an item, sees it listed, and marks it done.

**Why this priority**: the capture-and-complete loop is the whole product.
**Independent test**: add an item, toggle it done, reload — the state persists.

**Acceptance scenarios**

- [x] **AC1** — **Given** an empty list, **When** the user adds "buy milk", **Then** it appears as an open item.
- [x] **AC2** — **Given** an open item, **When** the user toggles it, **Then** it renders completed and survives a reload.

## Requirements

### Functional Requirements

- **FR-001**: The app MUST persist items across reloads using browser storage.

## Success Criteria

- **SC-001**: Add, complete, and reload round-trip works with no console errors.
