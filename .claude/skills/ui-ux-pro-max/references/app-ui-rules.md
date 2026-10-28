# Common rules for professional app UI

Frequently overlooked issues that make a UI look unprofessional. Scope: app UI
(iOS, Android, React Native, Flutter), not desktop-web interaction patterns.

## Icons and visual elements

| Rule | Standard | Why it matters |
|---|---|---|
| **No emoji as structural icons** | Vector icon sets (Lucide, `react-native-vector-icons`, `@expo/vector-icons`) for navigation, settings, and system controls | Emoji are font-dependent, inconsistent across platforms, and cannot follow design tokens |
| **Vector-only assets** | SVG or platform vector icons that scale and theme | Raster icons blur, and cannot adapt to light/dark |
| **Consistent icon sizing** | Size tokens (`icon-sm`, `icon-md` = 24pt, `icon-lg`) | Arbitrary 20/24/28pt mixing breaks rhythm and hierarchy |
| **Stroke consistency** | One stroke width per visual layer (1.5px or 2px) | Mixed strokes read as unfinished |
| **Filled vs outline discipline** | One icon style per hierarchy level | Mixing them at the same level muddies semantics |
| **Icon alignment** | Align to the text baseline with consistent padding | Prevents subtle imbalance that lowers perceived quality |
| **Icon contrast** | 4.5:1 for small elements, 3:1 minimum for larger glyphs | Keeps icons legible in both themes |
| **Touch target minimum** | ≥44×44pt interactive area; use `hitSlop` when the glyph is smaller | Meets accessibility and platform usability standards |
| **Stable interaction states** | Express press with color, opacity, or elevation | Layout-shifting transforms jitter the surrounding content |
| **Correct brand logos** | Official assets, their spacing and clear-space rules | Avoids brand misuse and platform compliance problems |

## Interaction

| Rule | Do | Don't |
|---|---|---|
| **Tap feedback** | Clear pressed state (ripple, opacity, elevation) within 80–150ms | No visual response on tap |
| **Animation timing** | 150–300ms micro-interactions with platform easing | Instant snaps or >500ms animations |
| **Accessibility focus** | Screen-reader order matches visual order; descriptive labels | Unlabeled controls, confusing traversal |
| **Disabled state clarity** | Native disabled semantics, reduced emphasis, no tap action | Controls that look tappable and do nothing |
| **Touch target minimum** | ≥44×44pt (iOS) or 48×48dp (Android); expand the hit area | Icon-only hit areas without padding |
| **Gesture conflict prevention** | One primary gesture per region | Nested tap/drag conflicts causing accidental actions |
| **Semantic native controls** | `Button`, `Pressable`, or the platform equivalent with proper roles | Generic containers used as primary controls |

## Light and dark mode contrast

| Rule | Do | Don't |
|---|---|---|
| **Surface readability** | Separate cards from the background with enough opacity or elevation | Over-transparent surfaces that blur hierarchy |
| **Text contrast** | ≥4.5:1 body text in both themes; ≥3:1 secondary on dark | Low-contrast gray body text, or dark-mode text that blends in |
| **Border and divider visibility** | Separators visible in both themes | Theme-specific borders that vanish in one mode |
| **State contrast parity** | Pressed, focused, and disabled equally distinguishable in both | Interaction states defined for one theme only |
| **Token-driven theming** | Semantic color tokens mapped per theme | Hardcoded per-screen hex values |
| **Scrim legibility** | A modal scrim strong enough to isolate the foreground (typically 40–60% black) | A weak scrim leaving the background competing |

## Layout and spacing

| Rule | Do | Don't |
|---|---|---|
| **Safe areas** | Respect top and bottom safe areas for fixed headers, tab bars, CTA bars | Fixed UI under the notch, status bar, or gesture area |
| **System bar clearance** | Space for status, navigation, and home indicator | Tappable content colliding with OS chrome |
| **Consistent content width** | Predictable width per device class | Arbitrary widths that change between screens |
| **Spacing rhythm** | One 4/8dp system for padding, gaps, and sections, with clear tiers (16/24/32/48) | Random increments; similar levels spaced differently |
| **Readable text measure** | Constrain long-form text on large devices | Edge-to-edge paragraphs on tablets |
| **Adaptive gutters** | Wider horizontal insets at larger widths and in landscape | The same narrow gutter everywhere |
| **Scroll and fixed coexistence** | Content insets so lists clear fixed bars | Scroll content hidden behind sticky headers or footers |

## Pre-delivery checklist

**Visual quality** — no emoji as icons; one icon family and style; official
brand assets with correct proportions; pressed states that do not shift layout;
semantic theme tokens with no ad hoc per-screen colors.

**Interaction** — pressed feedback on every tappable element; touch targets
≥44×44pt / 48×48dp; 150–300ms micro-interactions with native easing; disabled
states visually clear and non-interactive; screen-reader order matching visual
order with descriptive labels; no nested or conflicting gesture regions.

**Light/dark** — primary text ≥4.5:1 and secondary ≥3:1 in both themes;
dividers and interaction states distinguishable in both; scrim opacity
preserving foreground legibility; both themes actually tested, not inferred
from one.

**Layout** — safe areas respected for headers, tab bars, and bottom CTA bars;
scroll content clear of fixed bars; verified on small phone, large phone, and
tablet in both orientations; insets adapting by size and orientation; the 4/8dp
rhythm maintained at component, section, and page level; long-form text measure
readable on larger devices.

**Accessibility** — accessibility labels on all meaningful images and icons;
labels, hints, and clear error messages on form fields; color never the only
indicator; reduced motion and dynamic text size supported without layout
breakage; traits, roles, and states (selected, disabled, expanded) announced
correctly.
