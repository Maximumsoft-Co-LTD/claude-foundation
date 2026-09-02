# Change workflow

Read any compact brainstorming agreement, approved Decision Sheet, requirements,
locked decisions, architecture/contracts, production path, tests, dependencies,
and repository facts first. Reuse settled answers without asking them again.
Challenge production entry, real wire, activation, negative oracles, and
environment authority. If no finalized sheet exists, ask every unresolved
material choice in one Decision Sheet. Always hash reads in `grounding.yaml`.
Create no decision-tree or interview ledger. Only a real contradiction permits
one batched `--reopen-grounding`.

For a standard change, source-check project-specific terms from the agreement
and write only resolved canonical terms, meanings, and avoided aliases under
`design.md` Domain language; use `none` when the change introduces none. Record
a durable Decision only when it is hard to reverse, surprising without context,
and chosen among meaningful alternatives. Give it a stable `DEC-*` ID, status,
choice, why, rejected option, consequences, and supersession reference.
Never create `CONTEXT.md`, a glossary artifact, or an ADR store; never add
`design.md` to a rapid packet by hand.

For every new standard packet, complete every `grounding.yaml > nfrAssessment`
row. Assessment is mandatory; invented targets are forbidden. Mark an irrelevant
category `not-applicable` with a source-grounded reason. An applicable category
needs an observable target, claim IDs, task ownership, and a configured capable
provider. Performance and capacity targets require a numeric threshold. Security
needs a negative-path or privacy-control claim. Carry unresolved material targets
through the one Decision Sheet rather than guessing them.

Before writing each spec delta, read the canonical
`openspec/specs/<capability>/spec.md` when it exists and select the operation
from that state:

- `ADDED` introduces a requirement name the canonical spec does not declare.
- `MODIFIED` changes an existing requirement without changing its identity;
  copy the complete requirement and every existing scenario, then edit it.
- `REMOVED` retires an existing requirement and states a non-empty
  `**Migration:**` or `**Compatibility:**` consequence.
- A rename is the old requirement under `REMOVED` plus the new requirement
  under `ADDED`; never reuse one requirement name in two sections.

Do not default to `ADDED` without comparing the canonical spec. Emit only
sections that contain requirements and delete every unused template section.
For a fresh standard scaffold, overwrite the generated
`specs/change/spec.md`; do not create a second spec directory or delete the
generated file.

Record AWS/IAM/secret/Terraform/deploy/restart ownership in `handoffs.yaml` with
timing, activation safety, evidence, runbook, rollback, claims, and tasks.

For defects, derive critical cases from the reported repro plus adjacent input
partitions and source-language representation/coercion boundaries. For numeric
inputs, consider zero, signs, integral/fractional values, NaN/infinity, and
coercible representations only when the production API can receive them.

Run `doctor --stage change`; reuse an existing change. Otherwise classify before creating it
from the user's intent without reading framework implementation: rapid is only
low-impact isolated unit/static work. If a material choice is genuinely
unresolved, ask every such choice in one Decision Sheet; otherwise record
reviewed defaults and continue. Before authoring or validating, resolve impact,
coupling, security, surface, acceptance, review, evidence wiring, grounding, and
external operations in one complete structured draft.
Omit `--security` when there are no triggers. Declare surface and wire evidence;
settle the reviewer now. Prove must not discover an unnamed operator.

For fresh work, read `claude-foundation change start --template` once as the
versioned input contract, write the completed draft to
`.foundation/change-start-<id>.json`, then run
`claude-foundation change start .foundation/change-start-<id>.json --consume-draft`.
This is the default creation path: it validates the compiled packet before
entering Build and rolls back partial agreement/runtime state on failure. Repair
the single draft and retry when start reports contract findings. Do not patch a
partially generated packet. Use `change new` only to resume/manual-author an
existing legacy flow that cannot be represented by the structured draft.

Classify trust and operations by boundary, not vocabulary. Parsing or writing a
single-user, app-owned local file is not by itself untrusted input, a security
trigger, privacy work, or an operated service. CLI stderr and exit codes are not
observability or operability. Declare those NFRs only when data crosses an
actor/privilege boundary or a real runtime/operator consumes the control.

For an existing manually authored change, complete artifacts/tasks, validate,
run Build doctor, and sync. A successful atomic start is already validated; do
not validate it a second time. Offer
`change abandon` for an unprovable contract; never retire one unasked, infer
acceptance from silence, or expose harness fields. Summarize outcome,
boundaries, proof, completed work, and next action in the user's language;
keep lifecycle fields internal.

The versioned start draft plus generated artifacts and `change validate` are the
authoring contract.
`.claude/harness/EVIDENCE.md` may explain adapters.
Never inspect managed `.claude/harness/**` or `.claude/hooks/**` to infer fields or repair validation.
New production, runtime, or test-topology paths need an implementation task and
`sha256: planned` in `grounding.yaml`; never create product code during Change
to obtain a digest.
Run validate standalone, never through a pipe; its output is bounded.
Repair only reported fields. On each cycle repair them as one
dependency-ordered batch, then validate
again. Continue without a repair-count limit while progress changes. At a
decision, authority, resource, contradiction, or repeated no-progress boundary,
preserve the draft, present the supported choices, and resume this same Change
after resolution. After `VALID`, proceed directly to Build. Optional audit warnings are advisory and
never justify `--reopen-grounding`. If recovery is incomplete, report a harness
defect instead of inspecting internals.
