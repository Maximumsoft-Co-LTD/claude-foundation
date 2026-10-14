# Investigation continuity delivery smoke — 2026-10-15

[ภาษาไทย](investigation-continuity-smoke-2026-10-15.th.md)

The approved Investigate → Change implementation reached `archived` before
this verification. It preserves requirement revisions and conversation
provenance, routes material questions while exposing independent work, ties
experiments to requirements, and compiles detailed native Change documentation
with source coverage. The agreement and completed implementation ledger are in
[the archived change](../../openspec/changes/archive/2026-10-14-investigation-requirement-continuity/tasks.md).
Canonical behavior is defined in [WORKFLOW.md](../../WORKFLOW.md).

## Scope and authority

The user authorized commit, push and scenario testing, then explicitly approved
a total model-spend ceiling of US$200. One maintained `notes-api` Change Loop
lane was selected, with the stricter matrix ceiling of US$10, 30 minutes,
150 model requests and 150 tool calls. No release publication or baseline
comparison was performed.

The upstream change's late validator corrections were delivered with the
user's explicit review waiver after both configured AI review waves were
exhausted. Tests passed, but those corrections have no fresh independent review.
The disposable paid lab separately uses its documented main-session
self-review authority; this does not change consumer review policy.

## Observed results

| Check | Result |
|---|---|
| Investigate and semantic-draft regression tests | 130 passed |
| Authoritative repository suite after Land | All 225 suites passed, 8 workers, exit 0 |
| Documentation consistency | 139/139 assertions passed |
| Git whitespace check | Passed |
| Frozen deterministic sentinel | 12/12 scenario rows passed; zero model spend |
| Paid `notes-api` lane | Strict pass, `completed`, lifecycle `archived` |
| Archived task ledger | 0 pending tasks |
| Hidden task oracle | 13/13 passed, executed before Land |
| Delivered project tests | 15/15 passed |
| Clean installation | `npm install --ignore-scripts` passed with isolated caches |
| Tests after clean installation | 15/15 passed |
| Product quality | 28 mapped functions passed, 0 warnings/failures; mean function coverage 86.21%, maximum CRAP 13.01 |
| Paid lane wall time | 148.911 seconds to the measured terminal boundary |
| Measured host cost | US$0.5192617 from the final host result envelope |
| Stream-observed model requests | 12 before terminal, 1 after terminal |
| Host friction | 0 hook blocks, 0 permission prompts, 1 tool error |

The one tool error did not prevent strict completion. This run uses the normal
Change → Build → Prove → Land route. It does not exercise a paid multi-turn
Investigate conversation. Requirement corrections, history retention, material
and nonmaterial questions, malformed input, selective experiment staleness,
Thai reporting and compiled handoff coverage are covered by deterministic
runtime/seam regressions instead.

## Source and retained evidence

Run ID: `investigation-continuity-notes-api-20261015`. Execution was on
2026-10-14 at 15:55–15:57 UTC (2026-10-15 in Asia/Bangkok).
Source HEAD was `d157286b9b32c4374fcb94accf7c1a430c04228d`, with the landed
implementation as a dirty patch. The recorded source-patch digest is
`sha256:a930e39f29cae09220e439f639487330e3d27ea1cde76123ba66d1f90d55733a`.
New installed files are retained in the installation manifest. This is
development smoke evidence, not an immutable release checkpoint.

The disposable consumer was removed after verification. All 41 files in the
retained integrity manifest were independently checksum-verified. Raw evidence
is preserved outside Git and disposable state at
`~/.local/share/changeloop/scenarios/investigation-continuity-notes-api-20261015.tar.gz`,
SHA-256 `7990b7d1acfce0b4914b534b315ffb977da4bf6b6d6f8846e6c606b06e44af65`.
It includes the source patch, installed manifest, lifecycle receipts/logs,
host stream/result, oracle, archived agreement and scorecard.

One paid run provides smoke evidence only. No repeat variance, paired baseline,
full paid portfolio or production assurance is claimed. The scorecard did not
resolve actual model identity; unavailable timing dimensions remain unavailable.
