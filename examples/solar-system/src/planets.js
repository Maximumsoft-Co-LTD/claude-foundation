// planets.js — pure data module for the solar-system field guide.
//
// No DOM, no side effects: the dataset plus a handful of pure helpers.
// This split (state/data in → values out) is what lets tests.html exercise
// the logic without rendering, mirroring the foundation's
// `pure-core, side-effects at the edge` pattern.

/** The Sun — a star, not a planet, so it carries its own stat shape. */
export const SUN = Object.freeze({
  id: 'sun',
  name: 'The Sun',
  kind: 'star',
  type: 'G-type star',
  designation: 'Sol · Yellow dwarf',
  tagline: 'The anchor of everything',
  color: '#ffb454',
  // Orrery placement (the Sun sits dead centre, so no orbit/duration).
  size: 0,
  diameterKm: 1_391_000,
  surfaceTempC: 5500,
  coreTempC: 15_000_000,
  ageBillionYears: 4.6,
  massShare: '99.86%',
  description:
    'Our local star is a vast sphere of hot plasma whose gravity holds the ' +
    'entire solar system together. Nuclear fusion in its core fuses hydrogen ' +
    'into helium, releasing the light and heat that make life possible.',
  fact: 'The Sun makes up about 99.86% of all the mass in the solar system.',
})

/**
 * The eight planets, ordered outward from the Sun.
 *
 * Orrery fields (`orbit`, `size`, `duration`, `phase`) are stylised for a
 * legible animation — they are NOT to scale. Real measurements live in the
 * stat fields (`distanceAu`, `diameterKm`, …) and the size chart uses those.
 */
export const PLANETS = Object.freeze(
  [
    {
      id: 'mercury',
      name: 'Mercury',
      order: 1,
      type: 'Terrestrial',
      designation: 'Planet I · Terrestrial',
      tagline: 'The swift messenger',
      color: '#b6a692',
      distanceAu: 0.39,
      distanceMkm: 57.9,
      diameterKm: 4879,
      dayLabel: '58.6 Earth days',
      yearLabel: '88 Earth days',
      moons: 0,
      tempLabel: '−173 to 427 °C',
      orbit: 23,
      size: 10,
      duration: 8,
      phase: 0.12,
      description:
        'The smallest planet and the closest to the Sun, Mercury is a ' +
        'cratered, airless world of extremes — scorched by day, frozen by ' +
        'night. With almost no atmosphere to hold heat, its surface swings ' +
        'more than 600 °C between sunlight and shadow.',
      fact: 'A single solar day on Mercury lasts two of its years.',
    },
    {
      id: 'venus',
      name: 'Venus',
      order: 2,
      type: 'Terrestrial',
      designation: 'Planet II · Terrestrial',
      tagline: 'The veiled furnace',
      color: '#e8b96a',
      distanceAu: 0.72,
      distanceMkm: 108.2,
      diameterKm: 12_104,
      dayLabel: '243 Earth days',
      yearLabel: '225 Earth days',
      moons: 0,
      tempLabel: '464 °C (mean)',
      orbit: 33,
      size: 15,
      duration: 12,
      phase: 0.62,
      description:
        'Wrapped in a crushing carbon-dioxide atmosphere and clouds of ' +
        'sulfuric acid, Venus is the hottest planet in the solar system — hot ' +
        'enough to melt lead. It spins backwards, and so slowly that its day ' +
        'is longer than its year.',
      fact: 'Venus is the brightest natural object in our night sky after the Moon.',
    },
    {
      id: 'earth',
      name: 'Earth',
      order: 3,
      type: 'Terrestrial',
      designation: 'Planet III · Terrestrial',
      tagline: 'The pale blue dot',
      color: '#4a9ed6',
      distanceAu: 1,
      distanceMkm: 149.6,
      diameterKm: 12_742,
      dayLabel: '24 hours',
      yearLabel: '365.25 days',
      moons: 1,
      tempLabel: '15 °C (mean)',
      orbit: 45,
      size: 16,
      duration: 16,
      phase: 0.3,
      description:
        'The only world known to harbour life, Earth is a planet of liquid ' +
        'water, breathable air and shifting tectonic plates. Its single large ' +
        'Moon steadies the axial tilt that gives us reliable seasons.',
      fact: 'Earth is not a perfect sphere — it bulges at the equator, so you weigh slightly less there.',
    },
    {
      id: 'mars',
      name: 'Mars',
      order: 4,
      type: 'Terrestrial',
      designation: 'Planet IV · Terrestrial',
      tagline: 'The rust-red desert',
      color: '#d0563a',
      distanceAu: 1.52,
      distanceMkm: 227.9,
      diameterKm: 6779,
      dayLabel: '24.6 hours',
      yearLabel: '687 Earth days',
      moons: 2,
      tempLabel: '−65 °C (mean)',
      orbit: 56,
      size: 12,
      duration: 22,
      phase: 0.82,
      description:
        'The rust-red desert world, Mars hosts the tallest volcano and one of ' +
        'the deepest canyons in the solar system. Ancient riverbeds and polar ' +
        'ice caps hint at a warmer, wetter past.',
      fact: 'Olympus Mons rises about 22 km — nearly three times the height of Mount Everest.',
    },
    {
      id: 'jupiter',
      name: 'Jupiter',
      order: 5,
      type: 'Gas giant',
      designation: 'Planet V · Gas giant',
      tagline: 'The king of planets',
      color: '#cf9b6b',
      distanceAu: 5.2,
      distanceMkm: 778.5,
      diameterKm: 139_820,
      dayLabel: '9.9 hours',
      yearLabel: '11.9 Earth years',
      moons: 95,
      tempLabel: '−110 °C (cloud tops)',
      orbit: 68,
      size: 32,
      duration: 32,
      phase: 0.05,
      description:
        'A colossal ball of hydrogen and helium, Jupiter is more massive than ' +
        'all the other planets combined. Its Great Red Spot is a storm wider ' +
        'than Earth that has raged for centuries.',
      fact: 'Jupiter spins so fast that a day there lasts under 10 hours.',
    },
    {
      id: 'saturn',
      name: 'Saturn',
      order: 6,
      type: 'Gas giant',
      designation: 'Planet VI · Gas giant',
      tagline: 'The ringed jewel',
      color: '#e3c97f',
      rings: true,
      distanceAu: 9.5,
      distanceMkm: 1434,
      diameterKm: 116_460,
      dayLabel: '10.7 hours',
      yearLabel: '29.5 Earth years',
      moons: 146,
      tempLabel: '−140 °C (cloud tops)',
      orbit: 80,
      size: 27,
      duration: 44,
      phase: 0.45,
      description:
        'Famous for its dazzling rings of ice and rock, Saturn is the ' +
        'second-largest planet and the least dense — it would float in a large ' +
        'enough ocean. A swirling family of moons orbits within and beyond its rings.',
      fact: 'Saturn’s rings are enormous but wafer-thin — mostly only about 10 metres thick.',
    },
    {
      id: 'uranus',
      name: 'Uranus',
      order: 7,
      type: 'Ice giant',
      designation: 'Planet VII · Ice giant',
      tagline: 'The sideways world',
      color: '#7fd4d6',
      distanceAu: 19.8,
      distanceMkm: 2871,
      diameterKm: 50_724,
      dayLabel: '17.2 hours',
      yearLabel: '84 Earth years',
      moons: 27,
      tempLabel: '−195 °C (mean)',
      orbit: 90,
      size: 21,
      duration: 58,
      phase: 0.7,
      description:
        'An ice giant tipped almost completely onto its side, Uranus rolls ' +
        'around the Sun like a barrel. Its pale blue-green colour comes from ' +
        'methane high in its frigid atmosphere.',
      fact: 'Its extreme tilt gives each pole about 42 years of continuous daylight, then 42 of darkness.',
    },
    {
      id: 'neptune',
      name: 'Neptune',
      order: 8,
      type: 'Ice giant',
      designation: 'Planet VIII · Ice giant',
      tagline: 'The windswept deep',
      color: '#4666c9',
      distanceAu: 30.1,
      distanceMkm: 4495,
      diameterKm: 49_244,
      dayLabel: '16.1 hours',
      yearLabel: '165 Earth years',
      moons: 14,
      tempLabel: '−200 °C (mean)',
      orbit: 100,
      size: 20,
      duration: 74,
      phase: 0.92,
      description:
        'The farthest planet, deep-blue Neptune is a cold, storm-lashed ice ' +
        'giant. It was the first planet found by mathematics — predicted on ' +
        'paper before anyone pointed a telescope at it.',
      fact: 'Neptune’s winds can top 2,000 km/h — the fastest in the solar system.',
    },
  ].map(Object.freeze),
)

/** Every selectable body, Sun first. */
export const BODIES = Object.freeze([SUN, ...PLANETS])

/** Look up any body (planet or Sun) by id. Returns undefined if unknown. */
export function getBody(id) {
  return BODIES.find((b) => b.id === id)
}

/** Group thousands with thin separators: 139820 → "139,820". */
export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US')
}

/** Astronomical units → kilometres (1 AU ≈ 149.6 million km). */
export function auToKm(au) {
  return au * 149_597_870
}

/**
 * Diameter as a fraction (0–1) of the largest planet, for the to-scale chart.
 * Linear on real diameters — Mercury really is ~1/29th of Jupiter's width.
 */
export function diameterRatio(diameterKm, planets = PLANETS) {
  const max = Math.max(...planets.map((p) => p.diameterKm))
  return diameterKm / max
}
