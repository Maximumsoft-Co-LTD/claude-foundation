# Spec: CSV export for reports

**ID**: 0002-feat-csv-export
**Type**: feat
**Status**: approved
**Ship as**: one-drop
**Field**: brownfield

## Goal

Let a user download the current report as a CSV file that matches the on-screen table row for row.

## User Stories

### US1 — Download the report as CSV (Priority: P1)

A user viewing a report clicks Export and receives a CSV of the same rows.

**Why this priority**: analysts need the data in a spreadsheet, and the HTML table is the only surface today.
**Independent test**: open a report, click Export, diff the CSV rows against the rendered table.

**Acceptance scenarios**

- [x] **AC1** — **Given** a report with rows, **When** the user clicks Export, **Then** a CSV downloads with one header line and one line per rendered row.
- [x] **AC2** — **Given** a value containing a comma, **When** it is exported, **Then** the field is quoted so the CSV parses correctly.

## Requirements

### Functional Requirements

- **FR-001**: The CSV row source MUST be the same `ReportService.rows` call the HTML table renders.

## Success Criteria

- **SC-001**: A round-trip parse of the CSV reproduces the rendered rows exactly.
