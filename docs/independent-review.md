# Independent review contract

Independent review runs from a fresh working directory containing only copied
diff, agreement, and proof-evidence artifacts. Implementation conversation,
reasoning history, operational state, ambient credentials, and the repository
working directory are not included. Lifecycle subprocesses clear the ambient
environment and restore only `PATH` plus explicitly whitelisted values.

The clean packet carries the complete deterministic risk-trigger set. A packet
that omits or replaces a required trigger is rejected before the reviewer is
called. Supported triggers cover authentication/authorization, public API
compatibility, migrations/persistent data, concurrency, irreversible actions,
security boundaries, multi-repository contracts, and anomalous evidence.

A finding can block only when it is `verified`, contains reproduction evidence,
and identifies affected proof providers. A hypothesis is retained in review
history but cannot become a blocking defect without reproduction. An
`accepted_risk` finding must be non-blocking and include an authority ID, actor,
rationale, and acceptance timestamp; that authority is serialized with the
review attempt.

When independent model-family policy is required, an empty family or the same
family as implementation is rejected. Headless convergence requires this by
default. App-server policy can require it with
`CHANGELOOP_REVIEW_INDEPENDENT_MODEL_FAMILY=required`; the implementation
family and requirement are written into the review request artifact.

Review attempt history, typed findings, accepted-risk authority, proof
freshness, and model-family context are durable. App-server restart revalidates
the durable proof artifact against the current workspace revision before it
allows another review attempt; stale proof never becomes ready-to-land.

Current limitation: the executable reviewer result can still self-report model
family and accepted-risk metadata. This does not satisfy the trusted contract
above for GA. The implementation must move reviewer identity to a trusted
attachment and require accepted risk to reference a separately persisted,
explicit authority record that reviewer stdout cannot mint.
