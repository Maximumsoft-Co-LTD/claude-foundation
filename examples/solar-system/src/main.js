// main.js — bootstrap. Generates the starfield, builds the views, and keeps
// the orrery, grid and focus card in sync around a single selected body.

import { getBody } from './planets.js'
import { buildOrrery, buildGrid, buildScale, renderFocus } from './render.js'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Scatter twinkling stars across the sky layer. */
function seedStars(host, count) {
  if (!host) return
  const frag = document.createDocumentFragment()
  for (let i = 0; i < count; i++) {
    const star = document.createElement('span')
    star.className = 'star'
    const size = 1 + Math.random() * 2
    star.style.cssText =
      `left:${(Math.random() * 100).toFixed(2)}%;` +
      `top:${(Math.random() * 100).toFixed(2)}%;` +
      `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
      `--tw:${(3 + Math.random() * 4).toFixed(1)}s;` +
      `--td:${(Math.random() * 5).toFixed(1)}s`
    frag.append(star)
  }
  host.append(frag)
}

/** Reveal sections as they scroll into view. */
function observeReveals() {
  const items = document.querySelectorAll('.reveal')
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((n) => n.classList.add('in'))
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      }
    },
    { threshold: 0.12 },
  )
  items.forEach((n) => io.observe(n))
}

function main() {
  seedStars(document.getElementById('starfield'), reduceMotion ? 60 : 110)

  const focus = document.getElementById('focus')
  const highlightOrrery = buildOrrery(document.getElementById('orrery'), select, { reduceMotion })
  const highlightGrid = buildGrid(document.getElementById('grid'), select)
  buildScale(document.getElementById('scale'), select)

  let current = null
  function select(id) {
    const body = getBody(id)
    if (!body || id === current) return
    current = id
    renderFocus(focus, body)
    highlightOrrery(id)
    highlightGrid(id)
  }

  // Pause / play
  const toggle = document.getElementById('toggle-motion')
  const stage = document.querySelector('.orrery')?.closest('.orrery-shell')
  function syncToggleLabel() {
    const paused = stage?.classList.contains('is-paused')
    toggle.textContent = paused ? '▶ Resume orbits' : '❚❚ Pause orbits'
  }
  toggle?.addEventListener('click', () => {
    stage?.classList.toggle('is-paused')
    syncToggleLabel()
  })
  syncToggleLabel()

  observeReveals()
  select('earth') // open on home
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  main()
}
