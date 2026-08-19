# sandbox

## ADDED Requirements

### Requirement: Sandbox sync validates the packet against its source tree

When Foundation validates a root change packet in preparation for sandbox synchronization, repository selection, grounding read-set paths, and repository target paths SHALL resolve from the root source tree. Validation of an active change packet SHALL continue to resolve those inputs from the isolated workspace.

#### Scenario: Root grounding input changed after sandbox creation

- **WHEN** a committed target update changes an immutable grounding input and the root packet records the new digest before `sandbox sync`
- **THEN** root validation accepts the target bytes and synchronization can replay or refresh the sandbox instead of failing against the stale sandbox copy

#### Scenario: Active validation remains isolated

- **WHEN** an active sandbox packet is validated during Build or Prove
- **THEN** repository inputs resolve from the sandbox and a target-only value cannot satisfy its grounding read set

#### Scenario: Root and sandbox repository selections differ

- **WHEN** root-source validation reads a refreshed repositories.yaml while the active sandbox still carries the prior selection
- **THEN** each validation uses the selection in its own packet tree and still enforces known repositories and declared dependencies
