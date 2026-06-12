# Rule: Delivery engineering by default

**Trigger:** any task that designs or changes how code reaches production — a CI/CD pipeline, build, deploy strategy, release process, containerization, environment config, or rollout/rollback. Invoke the `delivery-engineering` skill **before** changing the pipeline.

**Why:** the pipeline is production infrastructure, and every "the green build caught nothing / we can't roll back / works on my machine / Friday big-bang release" story is a missed delivery fundamental — a CI gate that means something, build-once-promote artifacts, config and secrets outside the image, and safe reversible deploys are minutes to design and outages to skip. This skill is the delivery-channel sibling to `git-workflow` (which owns branches/commits/PRs/recovery) and backs the `/dev` CI ship-gate.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/delivery-engineering/SKILL.md` — defer to it.
