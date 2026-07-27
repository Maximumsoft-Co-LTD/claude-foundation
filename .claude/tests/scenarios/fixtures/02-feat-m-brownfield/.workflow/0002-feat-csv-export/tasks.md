# Tasks: CSV export for reports

## Phase 1 — Foundational

- [x] T001 [AC1] Add the `.csv` format branch to `ReportController` over `ReportService.rows` — verify: `rspec spec/requests/report_csv_spec.rb` returns a CSV body with a header line.

## Phase 2 — User story 1

- [x] T002 [AC1] Emit one CSV line per rendered row — verify: the request spec asserts row count equals the table row count.
- [x] T003 [AC2] Quote fields that contain a comma — verify: a fixture value `a,b` round-trips through a CSV parser as one field.
