# Spec: Solar System 3D Three.js

**ID**: `0003-feat-solar-system-3d`
**Type**: feat
**Status**: draft
**Ship as**: one-drop
**Open PR on ship**: TBD
**E2E + visual**: off
**Parent**: none

## Goal

Build a self-contained interactive 3D solar system visualization in the browser using vanilla Three.js, so users can explore the solar system by orbiting a camera and clicking planets to learn basic facts.

## User Stories

### US1 — 3D Solar System Scene (Priority: P1) MVP

A user opens the page and sees an animated 3D solar system with the Sun and 8 planets orbiting at different speeds.

**Why this priority**: The scene is the foundation everything else builds on.
**Independent test**: Open page, verify Sun + 8 planets render and orbit.

**Acceptance scenarios**

- [x] **AC1** — **Given** the page loads, **When** the browser supports WebGL, **Then** a dark space background renders with the Sun at center and 8 planets at distinct orbital distances with visible orbit path rings. — `solar-system/index.html:239,290-337` (scene bg + sunMesh + 8 planetMeshes at distinct orbitalRadius + orbit LineLoop rings)
- [x] **AC2** — **Given** the scene is running, **When** time passes, **Then** each planet orbits the Sun at a distinct speed (inner planets faster than outer), animating smoothly at 60fps. — `solar-system/index.html:449-458` (rAF loop, per-planet `orbitalSpeed` decreasing Mercury→Neptune: 0.9→0.1)
- [x] **AC3** — **Given** the scene is running, **When** the user observes planets, **Then** each planet has a distinct color/gradient material and a visually distinguishable size (stylized, not realistic scale ratio between orbits and planets). — `solar-system/index.html#planet-data` (8 distinct hex colors + visualRadius 0.6–2.4, not to orbital scale)

---

### US2 — Camera Interaction (Priority: P2)

A user explores the solar system by rotating, zooming, and panning the camera using mouse controls.

**Why this priority**: Camera controls make the 3D scene explorable; without them the view is static.
**Independent test**: Load scene, drag to rotate, scroll to zoom, right-drag to pan.

**Acceptance scenarios**

- [x] **AC4** — **Given** the scene is loaded, **When** the user left-drags, **Then** the camera orbits around the center of the scene. — `solar-system/index.html#orbit-controls` (`OrbitControls` default left-drag rotate, `enableDamping`, target at origin)
- [x] **AC5** — **Given** the scene is loaded, **When** the user scrolls the mouse wheel, **Then** the camera zooms in/out with min/max distance limits. — `solar-system/index.html#orbit-controls` (`controls.minDistance = 10`, `controls.maxDistance = 400`)

---

### US3 — Planet Selection & Info Panel (Priority: P3)

A user clicks a planet to zoom the camera toward it and see an info panel with the planet's name and basic facts.

**Why this priority**: Selection + info is the interactive payoff; depends on US1 + US2.
**Independent test**: Click a planet, verify camera animates toward it and info panel appears.

**Acceptance scenarios**

- [x] **AC6** — **Given** the scene is loaded, **When** the user clicks on a planet, **Then** the camera smoothly animates to frame the selected planet and an info panel appears showing the planet's name, size, distance from the Sun, and orbital period. — `solar-system/index.html#raycaster-click`, `#info-panel` (`onPointerClick` → `focusPlanet` → `startCameraAnimation` lerp + `infoPanel.classList.add('visible')` populated from `planet.facts`)
- [x] **AC7** — **Given** a planet is selected, **When** the user clicks empty space or clicks a close button on the panel, **Then** the info panel closes and the camera returns to the default overview position. — `solar-system/index.html#deselect` (`deselect()` hides panel + animates camera to `DEFAULT_CAMERA_POSITION`); boundary: clicking empty space with nothing selected is a no-op (no `else` branch fires)
- [x] **AC8** — **Given** a planet is selected, **When** the user clicks a different planet, **Then** the camera transitions to the new planet and the info panel updates. — `solar-system/index.html#raycaster-click` (`focusPlanet` re-entrant: new click while `cameraAnim` in flight overwrites `cameraAnim` target, redirecting mid-flight per T014); Sun excluded from `planetMeshes` raycast targets so clicking Sun is a no-op (FR-005)

### Edge Cases

- What happens when the user resizes the browser window? The scene resizes to fill the viewport, maintaining aspect ratio (FR-009).

## Requirements

### Functional Requirements

- **FR-001**: System MUST render a Sun at the scene center with an emissive glow material.
- **FR-002**: System MUST render 8 planets (Mercury through Neptune) at distinct orbital radii.
- **FR-003**: Each planet MUST have a distinct color and visually distinguishable size.
- **FR-004**: Each planet MUST orbit the Sun continuously with a distinct angular speed.
- **FR-005**: Visible orbit path rings MUST be drawn for each planet's orbital path.
- **FR-006**: OrbitControls MUST support left-drag rotation, scroll zoom (clamped), and right-drag pan.
- **FR-007**: Clicking a planet MUST trigger a smooth camera animation toward it and display an info panel.
- **FR-008**: Clicking empty space or a close button MUST dismiss the info panel and return the camera.
- **FR-009**: The scene MUST handle window resize, updating camera aspect ratio and renderer size.

### Key Entities

- **Planet** — name, orbital radius, size, color, orbital speed, facts (size, distance, period).
- **Sun** — center body with emissive material.
- **InfoPanel** — HTML overlay showing selected planet data.

## Success Criteria

- **SC-001**: Animation runs at >= 60fps on a modern desktop browser (Chrome/Firefox/Edge latest).
- **SC-002**: A first-time user can click a planet and read its info within 5 seconds of page load.
- **SC-003**: Camera zoom-to-planet animation completes in under 1.5 seconds.
- **SC-004**: Page loads and renders the full scene in under 3 seconds on a broadband connection.

## Assumptions

- Modern browser with WebGL support; no graceful fallback needed.
- Planet data (sizes, distances, colors, facts) hardcoded in JavaScript.
- Desktop-primary (mouse); touch zoom/rotate supported natively by OrbitControls.
- Dark background simulating space.
- No sound effects.
- Three.js loaded from CDN (no build step required).
- Orbital speeds are proportional but compressed for visual appeal (not real-time scale).
- Planet sizes are stylized (not to-scale with orbital distances) so inner planets remain visible.
