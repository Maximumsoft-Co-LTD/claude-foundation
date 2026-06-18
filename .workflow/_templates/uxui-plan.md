# UX/UI plan: <title>

**Spec**: [./spec.md](./spec.md) · **Plan**: [./plan.md](./plan.md)
**Status**: draft | approved

The UX **design**, written from the spec before (or alongside) the implementation plan and signed off at the gate: every screen/state the feature needs (Scenes), low-fidelity ASCII wireframes for the layout, the user journeys that move across them (Scenarios), the visual + interaction direction, and the map proving each acceptance criterion has a scene/scenario that satisfies it. `frontend-design` builds the UI from this plan; `qa > Visual verification` checks the rendered result against it. **This file is the design, the rendered UI is the record.** Only UI-bearing runs get a UX plan — skip it for non-visual work (a pure API, a CLI, a backend refactor with no rendered surface).

## Scenes
Every screen / view / distinct UI state the feature needs — the inventory the implementer builds and the scenarios move across. One row per scene. A "scene" is a coherent UI surface (a page, a modal, a panel) at a given state; the same surface in a different state (loading vs error) is a *state* of one scene, not a new scene — capture those in the States column, not as new rows.

| Scene | Purpose | Key elements | States (loading / empty / error / success) | Entry → Exit |
|-------|---------|--------------|---------------------------------------------|--------------|
| S1: <name> | <what the user does here, one line> | <the few elements that carry the purpose> | <which of the four states apply + what each shows; `none` if the scene is static> | <how the user arrives → where each action leads> |

<!--
Scenes, ASCII wireframes, Scenarios, and AC ↔ scene mapping are the always-required sections. Add the rest only when this run needs them, then DELETE the ones it doesn't (no empty headers, no "N/A"). For unresolved bits, embed `[NEEDS CLARIFICATION: <who> — <what>]` inline at the spot it matters; Status can't reach `approved` while any marker remains.

- States column: enumerate ONLY the states a scene can actually reach. A read-only static label has `none`; a list view that fetches has loading + empty + error + success. The empty and error states are the ones implementers silently skip — name them here so they're built, not discovered in QA.
- A scene with no spec AC behind it is a scope-creep smell: either it serves an AC (map it below) or it belongs in `spec.md > Scope — Out`. Don't invent screens the requirements don't ask for.
-->

## ASCII wireframes
Low-fidelity layout sketches for the scenes above. These are **structure only** — boxes, hierarchy, ordering, and responsive changes — not visual polish. They let `frontend-design` and the implementer see the intended layout before code, and they give `qa > Visual verification` concrete layout properties to inspect when e2e/visual is enabled.

### S1: <name> — desktop
```text
+--------------------------------------------------+
| Header / nav                                     |
+----------------------+---------------------------+
| Primary content      | Secondary panel / actions |
|                      |                           |
+----------------------+---------------------------+
| Footer / status / helper text                    |
+--------------------------------------------------+
```

### S1: <name> — mobile
```text
+--------------------------+
| Header                   |
+--------------------------+
| Primary content          |
|                          |
+--------------------------+
| Actions / secondary info |
+--------------------------+
```

<!--
- Add at least one wireframe per scene. Include both desktop and mobile when layout changes across breakpoints; a single shared wireframe is fine when the layout is identical.
- Use ASCII only inside `text` fences. Keep labels short and tied to the Scene's Key elements. Do not use Mermaid here — this is a wireframe, not an architecture diagram.
- Show loading / empty / error variants only when the state materially changes layout. Otherwise name the variant in a note under the scene's wireframe instead of duplicating the whole sketch.
- The wireframe must not introduce a component or region that is absent from Scenes / AC mapping. If the sketch needs a new element, add it to the Scene row and map it to an AC or mark it as scope creep.
-->

## Scenarios
The key user journeys, each a walk **across** scenes. Number the steps; every step names the scene it happens in, the user action, and the result (often a transition to another scene or a state change). Cover the primary happy path AND the consequential alternate / error flows the spec's `on error / at boundary:` clauses imply — an unhappy flow that has no scenario is an unhappy path nobody designed.

### SC1: <scenario name> (happy path)
- **Actor:** <who> · **Precondition:** <what must be true to start> · **Satisfies:** AC1, AC2
1. [S1] <user action> → <result / transition to S2>
2. [S2] <user action> → <result>
3. ...

### SC2: <alternate / error scenario name>
- **Actor:** <who> · **Precondition:** <the boundary / error condition> · **Satisfies:** AC1 (on error)
1. [S1] <user action with bad input / at a limit> → <the error/empty state shown, per the scene's States column>
2. ...

<!--
- One scenario per consequential journey, not per click. A scenario that's a single step is probably a scene state, not a journey — fold it into the Scenes table.
- `Satisfies:` ties the scenario to the spec ACs it exercises; this is what feeds the AC ↔ scene mapping below. A scenario satisfying no AC is the same scope-creep smell as an unmapped scene.
- Don't invent the unhappy-path behaviour: if the spec's AC has an `on error / at boundary:` clause, the scenario renders it; if the spec is silent on a reachable error flow, mark `[NEEDS CLARIFICATION: <who> — error flow for <case>?]` rather than guessing.
-->

## UX direction & components
The visual + interaction direction the implementer codes against — the `ui-ux-pro-max` output grounded against the spec and any existing design system. Keep it decision-bearing, not a style essay.

- **Direction / style:** <the chosen style + why it fits this product/audience — e.g. "minimal dashboard, dense data, neutral palette"; cite the spec's References / examples to follow when one exists, or the existing app's design system>
- **Information architecture / layout:** <how scenes are organised — nav model, primary layout grid, what's above the fold>
- **Key components:** <the reusable components the scenes need — reuse existing ones where they exist (cite `path#anchor`); name net-new ones>
- **Interaction & feedback states:** <how loading / empty / error / success / disabled / focus read to the user — the cross-cutting rules the per-scene States columns instantiate>
- **Responsive:** <breakpoints the layout must hold at — at minimum a narrow mobile ≈375px + desktop; name every breakpoint the design changes at, so `qa > Visual verification` inspects them>
- **Accessibility:** <the a11y commitments that bound the build — contrast target, keyboard reachability, focus order, labels/roles, motion-reduction; the WCAG-level the run holds itself to>

<!--
- Reuse before invention: if the repo already has a design system / component library, the direction adapts it — name the tokens/components and cite paths. A net-new direction needs a one-line justification.
- Drive this from `ui-ux-pro-max` (style selection, palette, font pairing, the per-domain UX rules) and `frontend-design` (visual composition). Read the spec's `References / examples to follow` first — a user-provided design reference outranks a generated one.
- Measurable a11y/perf targets are NOT specified here as the home of truth: if the spec carries one as an AC (`measured:` clause), this section only echoes it. A target that lives only here is orphaned — the same rule as `spec.md > Non-functional requirements`.
-->

## AC ↔ scene mapping
The thread that proves the UX covers the requirements: every `spec.md` acceptance criterion maps to the scene(s) and scenario(s) that satisfy it — and every scene/scenario traces back to an AC. This is the UX analogue of `test-plan.md > Coverage plan`; it's what lets the gate confirm the design delivers the contract and `qa > Visual verification` know which surfaces to check.

| AC | Scene(s) | Scenario(s) | Notes |
|----|----------|-------------|-------|
| AC1 | S1, S2 | SC1, SC2 | |
| AC1 (on error / boundary) | S2 (error state) | SC2 | |

<!--
- Every spec AC with a user-observable surface gets a row — INCLUDING its `on error / at boundary:` clause (its own row, mapped to the error state/scenario). An AC that's purely backend (no rendered surface) is `no UI — backend only` in Notes, not omitted silently.
- An AC with no scene is a design gap (the requirement has no surface to satisfy it); a scene with no AC is scope creep. The gate reads this table to catch both.
-->
