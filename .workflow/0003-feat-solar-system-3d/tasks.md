# Tasks: Interactive 3D Solar System

**Plan**: [./plan.md](./plan.md) -- **Spec**: [./spec.md](./spec.md)
**Status**: draft

> **For humans** -- each `- [ ]` is one build step, in order; read the action + its `verify:`. The `T001`/`[P]`/`[AC1]`/`path#anchor` codes are for the build agents.

Phased + dependency-ordered. `[P]` = parallel-safe (different files, no unmet dependency). `[AC#]` ties the task to the acceptance scenario it delivers/verifies (`[DoD]` / `[SC-###]` for a Definition-of-Done or measurable-outcome task). MVP = the Phase 3 (P1) block.

## Phase 1: Setup

- [x] **T001** [DoD] Create project directory and HTML scaffold with Three.js CDN importmap, empty canvas, dark-background CSS reset, and module script block -- `solar-system/index.html` (new) -- verify: open file in browser, no console errors, blank dark page renders

## Phase 2: Foundational (blocks all stories)

- [x] **T002** [AC1] Define planet data array (8 planets: name, orbitalRadius, orbitalSpeed, visualRadius, hex color, facts object with diameter/distance/period) and Sun constants -- `solar-system/index.html#planet-data` (edit) -- verify: `console.log(PLANETS)` shows 8 entries with all fields populated
- [x] **T003** [AC1] Create Three.js scene, PerspectiveCamera, WebGLRenderer (antialias, fills viewport), and ambient + point light on the Sun -- `solar-system/index.html#scene-setup` (edit) -- verify: open file, renderer canvas appears full-viewport with dark background

## Phase 3: US1 + US2 -- 3D Scene with Orbiting Planets + Camera Controls (P1) MVP

- [x] **T004** [AC1] Render the Sun as an emissive sphere mesh at the origin using MeshBasicMaterial with bright yellow/orange emissive color -- `solar-system/index.html#sun-mesh` (edit) -- verify: Sun sphere visible at center of scene
- [x] **T005** [AC1] Create 8 planet meshes from the data array with MeshStandardMaterial using each planet's color, positioned at their orbital radius -- `solar-system/index.html#planet-meshes` (edit) -- verify: 8 colored spheres visible at distinct distances from Sun
- [x] **T006** [AC3] Add orbit ring geometry (RingGeometry or LineLoop) for each planet at its orbital radius -- `solar-system/index.html#orbit-rings` (edit) -- verify: 8 circular rings visible on the orbital plane
- [x] **T007** [AC2] Implement animation loop: each planet orbits the Sun by updating its position using `Math.cos/sin(elapsed * speed) * radius` per frame -- `solar-system/index.html#animation-loop` (edit) -- verify: all 8 planets visibly orbit at distinct speeds; inner planets faster than outer
- [x] **T008** [AC4] [AC5] Add OrbitControls (imported from Three.js CDN addons) with damping enabled; configure min/max zoom distance -- `solar-system/index.html#orbit-controls` (edit) -- verify: left-drag rotates, scroll zooms, right-drag pans

**Checkpoint** -- US1 + US2 testable on their own. Shippable MVP: Sun + 8 orbiting planets + orbit rings + camera controls.

## Phase 4: US3 -- Planet Selection and Info Panel (P2)

- [x] **T009** [AC6] Add Raycaster + click event listener; on click, intersect planet meshes (exclude Sun); on hit, store selected planet reference and begin camera animation (lerp camera position toward planet over ~60 frames) -- `solar-system/index.html#raycaster-click` (edit) -- verify: clicking a planet smoothly moves camera toward it
- [x] **T010** [AC6] Create HTML info panel overlay (absolute-positioned div with name, size, distance, orbital period fields); on planet select, populate from planet data and show panel -- `solar-system/index.html#info-panel` (edit) -- verify: clicking a planet shows a styled panel with correct facts
- [x] **T011** [AC7] Add deselect behavior: clicking empty space when a planet is selected, or clicking the panel close button, hides the panel and animates camera back to default position -- `solar-system/index.html#deselect` (edit) -- verify: clicking empty space or close button hides panel + camera returns to overview
- [x] **T012** [AC8] Ensure clicking empty space with no planet selected does nothing (no panel, no camera movement) -- `solar-system/index.html#click-empty-noop` (edit) -- verify: clicking empty space when nothing is selected produces no visible change
- [x] **T013** [AC8] [FR-005] Ensure clicking the Sun does nothing (Sun mesh excluded from raycast targets) -- `solar-system/index.html#sun-click-guard` (edit) -- verify: clicking the Sun shows no panel and does not move camera
- [x] **T014** [FR-006] Handle rapid multi-click: when a new planet is clicked while camera is animating to a previous planet, redirect animation to the new target and update info panel -- `solar-system/index.html#rapid-click` (edit) -- verify: rapidly clicking two different planets results in camera arriving at the second planet with its info shown

## Phase 5: US4 -- Responsive Viewport (P2)

- [x] **T015** [AC9] Add window resize event listener that updates renderer size and camera aspect ratio -- `solar-system/index.html#resize-handler` (edit) -- verify: resizing the browser window adjusts the canvas without stretching or letterboxing

## Phase 6: Polish

- [x] **T016** [SC-001] Verify 60fps performance: check that animation loop stays under 16ms per frame on a modern browser -- observe -- verify: open DevTools Performance tab, record 5s, confirm no frames exceed 16ms consistently
- [x] **T017** [SC-002] Verify page load time under 3s on broadband -- observe -- verify: DevTools Network tab shows DOMContentLoaded + Three.js CDN fetch + first render under 3s

---

## AC-to-task coverage

| AC | Delivering task(s) | Verifying task(s) |
|----|--------------------|--------------------|
| AC1 (scene + Sun + planets) | T002, T003, T004, T005 | T004, T005 |
| AC2 (orbiting + speeds + sizes) | T007 | T007 |
| AC3 (orbit rings) | T006 | T006 |
| AC4 (rotate camera) | T008 | T008 |
| AC5 (zoom + pan) | T008 | T008 |
| AC6 (click planet + zoom + panel) | T009, T010 | T009, T010 |
| AC7 (deselect + camera return) | T011 | T011 |
| AC8 (click empty = noop / deselect) | T012, T013 | T012, T013 |
| AC9 (responsive resize) | T015 | T015 |
| FR-005 (Sun click = noop) | T013 | T013 |
| FR-006 (rapid multi-click) | T014 | T014 |
| SC-001 (60fps) | T016 | T016 |
| SC-002 (load time < 3s) | T017 | T017 |
