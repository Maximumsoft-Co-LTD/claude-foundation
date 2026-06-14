// render.js — the impure DOM shell.
//
// Builds the orrery, focus card, world grid and scale chart from the pure
// data in planets.js, and wires selection. No data lives here.

import { SUN, PLANETS, formatNumber, diameterRatio } from './planets.js'

/** Tiny hyperscript helper. */
function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k === 'style') node.setAttribute('style', v)
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
    else if (v !== null && v !== undefined) node.setAttribute(k, v)
  }
  for (const kid of [].concat(kids)) {
    if (kid) node.append(kid.nodeType ? kid : document.createTextNode(kid))
  }
  return node
}

/** The six stat tiles, shaped per body kind. */
function statsFor(body) {
  if (body.kind === 'star') {
    return [
      { label: 'Type', value: body.type },
      { label: 'Diameter', value: formatNumber(body.diameterKm), sub: 'km' },
      { label: 'Surface', value: formatNumber(body.surfaceTempC), sub: '°C' },
      { label: 'Core', value: '15M', sub: '°C' },
      { label: 'Age', value: body.ageBillionYears, sub: 'Gyr' },
      { label: 'System mass', value: body.massShare },
    ]
  }
  return [
    { label: 'Distance', value: formatNumber(body.distanceMkm), sub: 'M km' },
    { label: 'Diameter', value: formatNumber(body.diameterKm), sub: 'km' },
    { label: 'Orbit', value: body.distanceAu, sub: 'AU' },
    { label: 'Day', value: body.dayLabel },
    { label: 'Year', value: body.yearLabel },
    { label: 'Moons', value: body.moons },
  ]
}

/** Re-render the focus card for the selected body. */
export function renderFocus(host, body) {
  host.style.setProperty('--accent', body.color)
  const order = body.kind === 'star' ? 'Our star' : `No. ${body.order} of 8`
  host.replaceChildren(
    el('div', { class: 'focus__glow' }),
    el('p', { class: 'focus__order' }, `${order} · ${body.designation}`),
    el('h2', { class: 'focus__name' }, body.name),
    el('p', { class: 'focus__tagline' }, `“${body.tagline}”`),
    el('p', { class: 'focus__desc' }, body.description),
    el(
      'div',
      { class: 'stats' },
      statsFor(body).map((s) =>
        el('div', { class: 'stat' }, [
          el('span', { class: 'stat__label' }, s.label),
          el('div', { class: 'stat__value' }, [
            String(s.value),
            s.sub ? el('small', {}, ` ${s.sub}`) : null,
          ]),
        ]),
      ),
    ),
    el('p', { class: 'focus__fact' }, [el('b', {}, 'Did you know'), body.fact]),
  )
}

/** Build the animated orrery. Returns a select() that highlights a body. */
export function buildOrrery(host, onSelect, { reduceMotion } = {}) {
  const armEls = new Map()
  const orbitEls = new Map()

  const sun = el('button', {
    class: 'sun',
    type: 'button',
    'aria-label': 'The Sun',
    'aria-pressed': 'false',
    onclick: () => onSelect(SUN.id),
  })
  host.append(sun)

  for (const p of PLANETS) {
    const dot = el('button', {
      class: `body${p.rings ? ' body--rings' : ''}`,
      type: 'button',
      'aria-label': p.name,
      'aria-pressed': 'false',
      style: `--s:${p.size}px;--accent:${p.color}`,
      onclick: () => onSelect(p.id),
    }, [el('span', { class: 'body__name' }, p.name)])

    // Negative delay spreads the planets around their orbits from frame zero,
    // so even paused (reduced-motion) they aren't all lined up at 12 o'clock.
    const delay = `${-(p.duration * p.phase)}s`
    const arm = el('div', { class: 'orbit__arm', style: `--dur:${p.duration}s;animation-delay:${delay}` }, [dot])
    dot.style.animationDelay = delay

    const orbit = el('div', { class: 'orbit', style: `--d:${p.orbit}%` }, [arm])
    host.append(orbit)
    armEls.set(p.id, dot)
    orbitEls.set(p.id, orbit)
  }

  if (reduceMotion) host.parentElement.classList.add('is-paused')

  return function select(id) {
    sun.classList.toggle('is-active', id === SUN.id)
    sun.setAttribute('aria-pressed', String(id === SUN.id))
    for (const [pid, dot] of armEls) {
      const on = pid === id
      dot.classList.toggle('is-active', on)
      dot.setAttribute('aria-pressed', String(on))
      orbitEls.get(pid).classList.toggle('is-active', on)
    }
  }
}

/** Build the scannable grid of all bodies. Returns a select() highlighter. */
export function buildGrid(host, onSelect) {
  const cards = new Map()
  const bodies = [SUN, ...PLANETS]

  for (const b of bodies) {
    const meta =
      b.kind === 'star'
        ? [['Diameter', `${formatNumber(b.diameterKm)} km`], ['Surface', `${formatNumber(b.surfaceTempC)} °C`]]
        : [['Moons', String(b.moons)], ['Year', b.yearLabel]]

    const card = el('button', {
      class: 'card',
      type: 'button',
      'aria-pressed': 'false',
      style: `--accent:${b.color}`,
      onclick: () => onSelect(b.id),
    }, [
      el('div', { class: 'card__top' }, [
        el('span', { class: 'card__orb' }),
        el('span', { class: 'card__order' }, b.kind === 'star' ? 'Star' : `0${b.order}`),
      ]),
      el('h3', { class: 'card__name' }, b.name),
      el('p', { class: 'card__tagline' }, b.tagline),
      el('div', { class: 'card__meta' }, meta.map(([k, v]) =>
        el('span', {}, [`${k} `, el('b', {}, v)]),
      )),
    ])
    host.append(card)
    cards.set(b.id, card)
  }

  return function select(id) {
    for (const [cid, card] of cards) {
      const on = cid === id
      card.classList.toggle('is-active', on)
      card.setAttribute('aria-pressed', String(on))
    }
  }
}

/** Build the to-scale diameter chart (planets only, linear on real size). */
export function buildScale(host, onSelect) {
  const MAX_PX = 150 // Jupiter, the widest planet
  for (const p of PLANETS) {
    const w = Math.max(6, Math.round(diameterRatio(p.diameterKm) * MAX_PX))
    host.append(
      el('div', { class: 'scale__item' }, [
        el('button', {
          class: 'scale__orb',
          type: 'button',
          'aria-label': `${p.name}, ${formatNumber(p.diameterKm)} km across`,
          style: `--w:${w}px;--accent:${p.color}`,
          onclick: () => onSelect(p.id),
        }),
        el('div', { class: 'scale__label' }, [p.name, el('span', {}, `${formatNumber(p.diameterKm)} km`)]),
      ]),
    )
  }
}
