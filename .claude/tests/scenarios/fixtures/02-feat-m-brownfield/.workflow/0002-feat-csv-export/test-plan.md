# Test plan: CSV export for reports

## Coverage plan

| AC | Level | Asserts |
|----|-------|---------|
| AC1 | integration | request spec — CSV body has one header plus one line per row |
| AC2 | unit | serializer quotes a comma-bearing field |

## Edge cases

- Empty report exports a header line and no data rows.
- A field containing a quote is escaped, not dropped.

## Fixtures / env

- A seeded report with three rows, one carrying a comma value.

## Coverage targets

- Branch coverage on the CSV serializer at or above the project floor.
