# Tasks: CSV export for reports

## Guardrails

- `` `app/services/report_service.rb#rows` `` — already tenant-scoped; the CSV branch must consume this method, not re-query, or the export leaks across tenants.
- `` `app/controllers/report_controller.rb#show` `` — the single authorisation point for the report; the `.csv` format must branch inside it rather than gain its own route.
- `` `app/views/reports/show.html.erb` `` — the HTML surface stays byte-identical; CSV is additive only.

## Phase 1 — Foundational

- [x] T001 [AC1] Add the `.csv` format branch to `ReportController` over `ReportService.rows` — verify: `rspec spec/requests/report_csv_spec.rb` returns a CSV body with a header line.

## Phase 2 — User story 1

- [x] T002 [AC1] Emit one CSV line per rendered row — verify: the request spec asserts row count equals the table row count.
- [x] T003 [AC2] Quote fields that contain a comma — verify: a fixture value `a,b` round-trips through a CSV parser as one field.
