---
name: change-impact-analysis
description: "Use before changing an API, schema, config, or shared behavior when you do not know who depends on it. Skip isolated code with known consumers."
---

# Change impact analysis

Find who depends on the behavior before you change it, and say how far each
safety fact was proven.

## Steps

1. State the expected behavior, the affected boundary, and the assumptions
   that would make the change safe.
2. Trace real consumers beyond symbol search: serialized bytes, configuration,
   storage, other processes, feature flags, downstream dependencies. Verify
   pinned dependency behavior from its source.
3. For each safety fact, cite the source and pick the cheapest executable check
   that could falsify it; run it only within permitted scope. Rank it with
   [references/proof-ladder.md](references/proof-ladder.md) and record observed,
   inferred, unproven, and cleared findings separately.
4. Map confirmed risks to consumer, failure, compatibility, migration/rollback,
   and evidence owner. Preserve public contracts unless the change names them.
5. Submit agreement findings through Change intake, revision, or amendment;
   keep in-contract findings with the returned repair; never hand-edit an
   approved agreement to match the implementation.

## Harness

Findings are analysis, not receipts; durable decisions go to OpenSpec. Follow
the harness workspace and resume routes; do not schedule workers or grant
Land/Git authority. Use `investigate` for read-only research, `plan-writing` for sequencing.

## References

- `references/proof-ladder.md` — the five proof levels and how to report where proof stopped.
