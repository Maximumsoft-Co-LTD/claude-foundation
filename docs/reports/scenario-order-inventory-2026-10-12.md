# Order/inventory paid workload audit — 2026-10-12

[ภาษาไทย](scenario-order-inventory-2026-10-12.th.md)

One Change Loop workload, including continuations, was explicitly authorized
under a US$25 total allowance. The delivered product passes all 19 hidden
acceptance groups, but the strict benchmark is **not green**: the runtime
reaches `archived` with all three canonical archived tasks still unchecked.
No receipt, proof, runtime JSON or archived task ledger was manually repaired.

## Observed result

| Check | Result |
|---|---|
| Pre-Land oracle on assembled repository sandboxes | PASS 19/19 |
| Post-Land oracle on delivered targets | PASS 19/19 |
| Ordinary `npm test` | PASS 21/21 |
| Offline clean installation | PASS |
| `npm test` after clean installation | PASS 21/21 |
| JavaScript quality | 47 mapped functions; 46 pass, one warning, zero failures |
| Coverage | Function mean 95.93%, minimum 33.33%; branch with function fallback |
| CRAP | Maximum 22.02; warning at `backend/server.mjs` `execute` |
| Target Git invariants | HEAD and raw index unchanged in backend, SDK and web |
| Runtime terminal state | `archived`; native `advance` reports delivered |
| Archived task ledger | FAIL: T001, T002 and T003 remain `[ ]` |
| Strict outcome | `incomplete`, `required-work-or-proof-incomplete`, pendingTasks=3 |

This exercises fifty stock reservations through two independent HTTP processes
sharing SQLite, concurrent identical keys, tenant/role boundaries, restart
persistence, expiry, cancellation, reordered events, SDK calls and immutable
web state. Each delivered surface's tests detect its original seed implementation.
Python transport coverage and rendered browser UI acceptance are unmeasured.

## Scope, source and cost

Installed runtime: v3.6.3, from source HEAD
`2fd46b4e3b29a2ac602e5d318a0571bae02ef244`. The working tree is dirty;
repository-only lab fixes were made during this exploratory run. Initial,
continuation and final observer snapshots and source patches are retained.
This is not an immutable release checkpoint or a baseline comparison.

Frozen product seed:
`sha256:16d697f6b2fda062bdfc8a07bb6a8084cbb36d9f7276b3fee22c2f0d63a8f1a9`.
The control root uses copy isolation; each selected child has a Git seed and
its own worktree. Product requirements remain in the frozen
`ORDER-INVENTORY.md`, not this report.

| Measured model execution | CLI-reported US$ |
|---|---:|
| Initial host; missing repository setup | 0.3202295 |
| Implementation host | 0.9259364 |
| Oracle continuation; no product edits | 0.1575998 |
| Configured reviewer (`opus` alias) | 0.6801810 |
| Total | **2.0839467** |

The three host envelopes identify `claude-sonnet-5-5`; the reviewer telemetry
records the requested `opus` alias. Main envelopes report list-price cost;
these values do not establish an extra subscription invoice. Native reviewer
cost is separate from the host envelopes and is included in the total above.
Two subsequent evaluation/audit continuations dispatch no model and report
measured zero. All cost entries used in the total are measured.

Paid-host stopwatches total 490323.687 ms (8.172 minutes), including the
configured review while the host was active. Operator preparation, observer
repairs and later delivery checks are separate. No stable speed or assurance
claim follows from this n=1 run; the direct baseline was not authorized or run.

## Lab defects corrected during the run

1. The catalog's `external` type did not waive the runtime's Git requirement.
   Lab preparation now creates the three disposable child Git seeds before
   Build. Initial permission denials and the unsuccessful attempt remain retained.
2. The pre-Land observer read old seed placeholders in the shared sandbox.
   It now assembles a private evaluation copy from the selected repository
   sandboxes, without writing to the proven sources or targets. The old 1/19
   verdict remains retained; the actual implementation passes 19/19 without
   a product repair. Post-Land evaluation uses the delivered targets.
3. Host continuation cost now sums all session envelopes, passes only the
   measured remaining host allowance to a repair, and pauses before another
   host when prior cost is unknown or partial. The native reviewer cost was
   separately checked and included in this run's total allowance.
4. Archived delivery evidence is collected even when an inconsistent task
   ledger keeps the strict outcome incomplete. Collection does not promote it.

## Runtime finding and next verification

Change:
`extend-the-catalogue-into-a-multi-tenant-order-and-reservation-s`.
Its change selection contains backend, SDK and web, without root.
Build completed and checked all three tasks in the active execution packet.
Land delivered the proven code and archived the packet at
`openspec/changes/archive/2026-10-12-extend-the-catalogue-into-a-multi-tenant-order-and-reservation-s/tasks.md`,
but that canonical archived file contains three unchecked tasks. The benchmark
correctly refuses completion despite the passing proof and product oracle.

The repair target is task-packet synchronization during child-only
multi-repository Land/archive. The precise internal cause is not established
by this report. Add a deterministic native regression at that boundary, fix
the synchronization, and replay a fresh consumer before declaring this lane
smoke-green. Rewriting the retained ledger or accepting runtime status alone
would conceal the finding. The source runtime has not been patched here.

## Retained evidence

Private evidence root:
`~/.local/share/changeloop/scenarios/order-inventory-20261012-approved25-1791806599121/`.
It contains authorization, all four stage scorecards/manifests, original host
streams and session envelopes, source snapshots, reviewer telemetry, proof,
archive, quality, clean-install checks, Git baselines/comparisons and a retained
consumer. `run-audit.json` is a derived audit, separate from machine proof.

Compressed raw archive:
`~/.local/share/changeloop/scenarios/order-inventory-20261012-approved25-1791806599121.tar.gz`.
SHA-256:
`8762e29b86c569986b85db8355fd7663ca03c4f4fcb7d6d379068f9ac0216383`.

Current lifecycle requirements and repeat gates remain in the
[canonical scenario plan](user-scenario-test-plan.md).
