# Test plan: Interactive 3D Solar System

**Spec**: [./spec.md](./spec.md)
**Plan**: [./plan.md](./plan.md) -- **Tasks**: [./tasks.md](./tasks.md)
**Status**: draft
**Mode**: Full (feat)

> **For humans** -- one row per spec promise (`AC#`): what each test checks, at which level (unit/integration). The rest is detail for the test agent.

## Coverage plan

| AC | Level | What the test asserts | Notes |
|----|-------|-----------------------|-------|
| AC1 (scene init) | integration | Scene contains a Sun mesh at origin (position 0,0,0) with emissive material, 8 planet meshes at distinct orbital radii, each with a unique color material | jsdom + Three.js scene graph inspection |
| AC1 (boundary: planet count) | unit | Planet data array has exactly 8 entries; each has name, orbitalRadius, orbitalSpeed, visualRadius, color, and facts with diameter/distance/period | Data integrity |
| AC2 (orbital motion) | integration | After advancing the clock by N frames, each planet's x/z position has changed; inner planets (Mercury) have moved a larger angular distance than outer (Neptune) | Clock mock + position comparison |
| AC2 (boundary: size distinction) | unit | All 8 planets have distinct `visualRadius` values > 0; no two planets share the same radius | Data uniqueness check |
| AC3 (orbit rings) | integration | Scene contains 8 orbit ring objects (Line or RingGeometry); each ring's radius matches its planet's orbital radius | Scene graph inspection |
| AC4 (camera rotation) | integration | Simulating a left-button mousedown+mousemove sequence changes the camera's azimuthal angle via OrbitControls | OrbitControls state assertion |
| AC5 (zoom + pan) | integration | Simulating a wheel event changes camera distance from target; distance stays within configured min/max bounds | Zoom clamp verification |
| AC5 (boundary: zoom limits) | integration | Scrolling past max zoom-out keeps camera at max distance; scrolling past max zoom-in keeps at min distance | OrbitControls clamp |
| AC6 (planet click + info) | integration | Raycaster intersecting a planet mesh triggers: (a) camera target position updates toward planet, (b) info panel element becomes visible, (c) panel text content matches clicked planet's name and facts | Raycaster + DOM assertion |
| AC6 (boundary: panel data accuracy) | unit | Each planet's facts object contains plausible values: diameter > 0, distance > 0, period string non-empty | Data sanity |
| AC7 (deselect) | integration | With a planet selected, simulating a click on empty space (raycaster returns no intersections) hides the info panel and resets camera target to the default overview position | State reset assertion |
| AC7 (boundary: close button) | integration | Clicking the info panel's close button hides the panel and returns camera to default position | DOM event + camera state |
| AC8 (click empty = noop) | integration | With no planet selected, clicking empty space produces no state change: info panel stays hidden, camera position/target unchanged | No-op guard |
| AC8 / FR-005 (Sun click = noop) | integration | Clicking the Sun mesh does not trigger selection; info panel stays hidden, camera does not animate | Sun exclusion from raycast targets |
| FR-006 (rapid multi-click) | integration | Clicking planet A, then immediately clicking planet B before animation completes: final camera target is planet B, info panel shows B's data | Animation redirect |
| AC9 (responsive resize) | integration | Dispatching a window resize event updates renderer.setSize and camera.aspect; canvas dimensions match new window dimensions | Resize handler |
| SC-001 (measured: 60fps) | integration | 100 consecutive animation frames complete within 1700ms wall-clock time | Performance sanity; advisory, not blocking in CI |
| SC-002 (measured: load < 3s) | integration | Scene initialization function completes within 3000ms | Init timing; advisory |

## Execution mechanism

- **Full-suite**: `npx vitest run` (Vitest + jsdom environment, Three.js mocked/imported)
- **Impacted**: `npx vitest run --reporter=verbose --testPathPattern=<pattern>` -- no native `related` mode in Vitest for inline HTML, so Impacted = filtered full suite

## Edge cases to probe

- Clicking the Sun -- must not show info panel or move camera (FR-005)
- Rapid double-click on two different planets -- camera and panel settle on the second planet (FR-006)
- Window resize during camera animation -- resize handler must not break the in-progress lerp
- Zoom to min/max limits -- OrbitControls clamp prevents camera from entering planet meshes or zooming infinitely out
- All 8 planet names match real solar system names in order (Mercury through Neptune)

## Out of test scope

- Visual pixel-level rendering (e2e_visual=off)
- Touch interaction (delegated to OrbitControls native support; no custom touch code)
- Browser compatibility matrix (single modern browser assumed)
- CDN availability / offline behavior
- Actual frame-rate measurement under GPU load (SC-001 is advisory in CI)
