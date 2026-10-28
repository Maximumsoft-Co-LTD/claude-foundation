# Quick Reference — the 10 rule categories

Scan the category you are working in; each rule is a short name plus the
standard it comes from. Platform notes: HIG = Apple Human Interface Guidelines,
MD = Material Design, WCAG = Web Content Accessibility Guidelines.

### 1. Accessibility (CRITICAL)

- `color-contrast` — 4.5:1 for normal text, 3:1 for large text
- `focus-states` — visible focus rings on interactive elements (2–4px)
- `alt-text` / `aria-labels` — descriptive alt text; a label on every icon-only
  button (`accessibilityLabel` in native)
- `keyboard-nav` / `keyboard-shortcuts` — tab order matches visual order, full
  keyboard support, keyboard alternatives for drag-and-drop, system and
  assistive shortcuts preserved
- `form-labels` — a real `label` bound to its field
- `skip-links`, `heading-hierarchy` — skip to main content; sequential h1→h6
- `color-not-only` — never convey meaning by color alone
- `dynamic-type` — support system text scaling without truncation
- `reduced-motion` — honor `prefers-reduced-motion`
- `voiceover-sr` — meaningful labels and hints, logical reading order
- `escape-routes` — cancel or back in every modal and multi-step flow

### 2. Touch & interaction (CRITICAL)

- `touch-target-size` / `touch-spacing` / `no-precision-required` — ≥44×44pt
  (HIG) or 48×48dp (MD), ≥8px between targets, extend the hit area beyond the
  glyph rather than demanding pixel-perfect taps
- `press-feedback` / `tap-feedback-speed` / `haptic-feedback` — visible
  response within ~100ms (ripple, highlight, MD state layer); haptics for
  confirmations, not everywhere
- `hover-vs-tap` / `cursor-pointer` / `tap-delay` — primary actions on tap, not
  hover; pointer cursor on clickables; `touch-action: manipulation` on web
- `loading-buttons` / `error-feedback` — disable during async work with a
  progress cue; put the error near its cause
- `standard-gestures` / `system-gestures` / `gesture-conflicts` — use platform
  gestures as users expect, never block system ones, avoid horizontal swipe on
  scrolling content
- `gesture-alternative` / `swipe-clarity` / `drag-threshold` — visible controls
  for every critical action, an affordance for swipe actions, a movement
  threshold before a drag starts
- `safe-area-awareness` — keep targets clear of notch, Dynamic Island, and the
  gesture bar

### 3. Performance (HIGH)

- Images and media: `image-optimization` (WebP/AVIF, `srcset`),
  `image-dimension` (width/height or `aspect-ratio` to prevent CLS),
  `lazy-loading`, `lazy-load-below-fold`
- Fonts and CSS: `font-loading` (`font-display: swap`), `font-preload` (critical
  only), `critical-css`
- JavaScript: `bundle-splitting`, `third-party-scripts` (async/defer, audited),
  `debounce-throttle`, `reduce-reflows` (batch DOM reads then writes),
  `virtualize-lists` (50+ items)
- Perceived speed: `progressive-loading` (skeletons over long spinners),
  `content-jumping` (reserve space), `input-latency` (<100ms),
  `main-thread-budget` (~16ms per frame)
- Degraded networks: `offline-support`, `network-fallback`

### 4. Style selection (HIGH)

- `style-match`, `consistency`, `color-palette-from-product` — match the style
  and palette to the product and industry, then keep it across every page
- `no-emoji-icons`, `icon-style-consistent` — one SVG icon family with a
  consistent stroke width and radius
- `effects-match-style`, `elevation-consistent` — shadow, blur, and radius
  belong to a single scale
- `platform-adaptive`, `system-controls` — respect HIG vs MD idioms and prefer
  native controls; customize only when branding requires it
- `state-clarity`, `dark-mode-pairing` — distinct hover/pressed/disabled states
  on-style, light and dark designed together
- `blur-purpose`, `primary-action` — blur signals background dismissal, not
  decoration; one primary CTA per screen

### 5. Layout & responsive (HIGH)

- `viewport-meta` (never disable zoom), `mobile-first`,
  `breakpoint-consistency` (e.g. 375/768/1024/1440)
- `readable-font-size` (≥16px body on mobile), `line-length-control` (35–60
  chars mobile, 60–75 desktop), `readable text measure` on tablets
- `horizontal-scroll` — content fits the viewport width
- `spacing-scale` (4/8dp rhythm), `touch-density`, `container-width`,
  `section spacing hierarchy`
- `z-index-management` — one layered scale, not ad hoc values
- `fixed-element-offset`, `scroll-behavior` — reserve insets for fixed bars and
  avoid nested scroll regions that fight the main scroll
- `viewport-units` (`min-h-dvh` over `100vh`), `orientation-support`,
  `content-priority`, `visual-hierarchy` (size, spacing, contrast — not color)
- `safe-area compliance` and `system bar clearance` for fixed headers, tab
  bars, and CTA bars

### 6. Typography & color (MEDIUM)

- `line-height` 1.5–1.75 body, `line-length` 65–75 chars, `font-scale`
  (e.g. 12/14/16/18/24/32), `font-pairing`, `letter-spacing` (platform default;
  no tight tracking on body)
- `text-styles-system` — use the platform type roles (iOS Dynamic Type styles,
  MD display/headline/title/body/label)
- `weight-hierarchy` — 600–700 headings, 400 body, 500 labels
- `contrast-readability`, `color-accessible-pairs` (4.5:1 AA, 7:1 AAA),
  `contrast-feedback` for error and success colors
- `color-semantic` — semantic tokens (primary, error, surface, on-surface), not
  raw hex in components
- `color-dark-mode` — desaturated tonal variants, contrast tested separately,
  never a naive inversion
- `color-not-decorative-only` — functional color always paired with icon or text
- `truncation-strategy` (prefer wrapping; give a path to the full value),
  `number-tabular`, `whitespace-balance`

### 7. Animation (MEDIUM)

- Timing: `duration-timing` (150–300ms micro, ≤400ms complex), `easing`
  (ease-out entering, ease-in exiting), `exit-faster-than-enter`,
  `spring-physics`, `motion-consistency` (shared duration/easing tokens)
- Meaning: `motion-meaning` (express cause and effect), `state-transition`,
  `continuity`, `shared-element-transition`, `hierarchy-motion`,
  `navigation-direction`, `fade-crossfade`, `modal-motion` (animate from the
  trigger)
- Restraint: `excessive-motion` (1–2 elements per view), `parallax-subtle`,
  `opacity-threshold`, `loading-states` (>300ms gets a skeleton or progress)
- Responsiveness: `interruptible`, `no-blocking-animation`, `gesture-feedback`
  (track the finger in real time), `scale-feedback` (0.95–1.05 on press)
- Technique: `transform-performance` (transform/opacity only),
  `layout-shift-avoid`

### 8. Forms & feedback (MEDIUM)

- Labels and help: `input-labels` (visible, not placeholder-only),
  `input-helper-text` (persistent), `required-indicators`, `field-grouping`,
  `progressive-disclosure`
- Input mechanics: `input-type-keyboard`, `autofill-support`,
  `password-toggle`, `touch-friendly-input` (≥44px), `read-only-distinction`,
  `disabled-states` (0.38–0.5 opacity plus the semantic attribute)
- Validation: `inline-validation` (on blur, not keystroke), `error-placement`
  (below the field), `error-clarity` (cause plus fix), `error-recovery`,
  `focus-management` (focus the first invalid field), `error-summary` with
  anchor links, `aria-live-errors`
- Outcomes: `submit-feedback`, `success-feedback`, `timeout-feedback` with
  retry, `empty-states`, `multi-step-progress`, `undo-support`,
  `confirmation-dialogs`, `destructive-emphasis`, `form-autosave`,
  `sheet-dismiss-confirm`
- Notifications: `toast-dismiss` (3–5s), `toast-accessibility` (never steal
  focus; `aria-live="polite"`)

### 9. Navigation patterns (HIGH)

- Structure: `bottom-nav-limit` (max 5, icon + label),
  `bottom-nav-top-level`, `drawer-usage` (secondary navigation),
  `tab-bar-ios`, `top-app-bar-android`, `adaptive-navigation` (sidebar ≥1024px),
  `nav-hierarchy`, `avoid-mixed-patterns`
- Orientation: `nav-state-active`, `nav-label-icon`, `breadcrumb-web` (3+
  levels), `navigation-consistency`, `persistent-nav`, `empty-nav-state`
- Movement: `back-behavior`, `state-preservation` (scroll, filters, input),
  `back-stack-integrity`, `gesture-nav-support`, `deep-linking`,
  `focus-on-route-change`
- Containment: `modal-escape`, `modal-vs-navigation` (modals are not a
  navigation flow), `overflow-menu`, `search-accessible`, `tab-badge`,
  `destructive-nav-separation`

### 10. Charts & data (LOW)

- Choice and shape: `chart-type` (trend → line, comparison → bar, proportion →
  pie), `no-pie-overuse` (>5 categories → bar), `data-density`,
  `trend-emphasis`, `large-dataset` (aggregate or sample past ~1000 points with
  drill-down)
- Labelling: `axis-labels` (units and scale), `axis-readability`,
  `legend-visible`, `direct-labeling`, `number-formatting` (locale-aware),
  `time-scale-clarity`
- Interaction: `tooltip-on-interact`, `tooltip-keyboard`, `legend-interactive`,
  `focusable-elements`, `touch-target-chart` (≥44pt), `sortable-table` with
  `aria-sort`, `drill-down-consistency`, `export-option`
- Accessibility: `color-guidance` (no red/green-only pairs), `pattern-texture`,
  `contrast-data` (3:1 marks, 4.5:1 labels), `data-table` alternative,
  `screen-reader-summary`, `animation-optional`
- States: `empty-data-state`, `loading-chart` (skeleton, not a bare axis),
  `error-state-chart` with retry, `responsive-chart` (reflow or simplify)
