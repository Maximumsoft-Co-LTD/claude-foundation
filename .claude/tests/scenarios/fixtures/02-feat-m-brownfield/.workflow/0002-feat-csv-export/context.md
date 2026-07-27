# Context: CSV export (current-state map)

## Current state

`ReportController#index` renders an HTML table from `ReportService.rows`. There is no server-side export today — users copy the table by hand.

## Blast radius

- `ReportService.rows` — the shared row source; both the table and the new CSV path read it.
- `config/routes.rb` — a new `reports.csv` format route sits beside the HTML one.

## Test infrastructure

RSpec request specs cover the HTML report. The CSV path adds a sibling request spec in the same directory.
