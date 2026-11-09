# Incident records

**Audience:** maintainers of `claude-foundation`. One file per incident: a
defect that reached a user, `main`, or a release candidate. Repository-only;
nothing here ships to consumers.

- Name files `YYYY-MM-DD-<short-slug>.md` and copy [_template.md](_template.md).
- The agent drafts the record; the service owner decides: fix now, schedule, or
  dismiss with a reason.
- A fix goes through the normal Change Loop. Link the change id here, and add a
  regression test or eval that fails without the fix.
- When the fix lands, add the durable lesson to [../lessons.md](../lessons.md).
- Do not edit a closed record to change history. Add a dated correction line.
- Never paste secrets, tokens, or consumer source code into a record.
