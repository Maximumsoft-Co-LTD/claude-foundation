# Incident records

**Audience:** maintainers and agents of this project. One file per incident: a
defect that reached users, production, or a release. These records are
project-owned: Change Loop seeds this folder once and never rewrites it.

- Name files `YYYY-MM-DD-<short-slug>.md` and copy [_template.md](_template.md).
- The agent drafts the record; the service owner decides: fix now, schedule, or
  dismiss with a reason.
- A fix goes through a Change Loop hotfix. Set its `bugfix.incident.link` to
  this record, and give it a scenario with `regressionOf: <incident link>`
  whose test fails without the fix. Change Loop refuses a new hotfix without
  that regression and archives it only when the regression is proven.
- When the fix lands, add the durable lesson to [../lessons.md](../lessons.md),
  which Change Loop reads before investigations and changes.
- Do not edit a closed record to change history. Add a dated correction line.
- Never paste secrets, tokens, credentials, or personal data into a record.
