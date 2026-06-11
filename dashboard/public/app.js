'use strict';

/* claude-foundation dashboard — polls /api/online and renders presence.
   The view key is held only in localStorage and sent as the x-cf-key header. */

const POLL_MS = 5000;
const KEY_STORE = 'cf-dashboard-key';

const $ = (id) => document.getElementById(id);
let timer = null;

// ── Key handling ────────────────────────────────────────────────────────────
function getKey() {
  return localStorage.getItem(KEY_STORE) || new URLSearchParams(location.search).get('key') || '';
}
function setKey(k) { localStorage.setItem(KEY_STORE, k); }
function clearKey() { localStorage.removeItem(KEY_STORE); }

function showGate(withError) {
  if (timer) { clearInterval(timer); timer = null; }
  $('gate').hidden = false;
  $('gate-error').hidden = !withError;
  $('gate-key').focus();
}
function hideGate() { $('gate').hidden = true; }

// ── Rendering helpers ───────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function relTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function activityLine(it) {
  const repo = escapeHtml(it.repo || '·');
  const branch = it.branch ? `<span class="act-branch">⎇ ${escapeHtml(it.branch)}</span>` : '';
  const run = it.runId
    ? `<span class="act-run">/dev ${escapeHtml(it.runId)}${it.phase ? ` · ${escapeHtml(it.phase)}` : ''}</span>`
    : '';
  return `<div class="act"><span class="act-repo">${repo}</span>${branch}${run}</div>`;
}

function workingLine(r) {
  const repo = escapeHtml(r.repo || '·');
  const label = r.label ? `<span class="wk-tag">${escapeHtml(r.label)}</span>` : '';
  const dir = r.dir ? `<div class="wk-dir">${escapeHtml(r.dir)}</div>` : '';
  const branch = r.branch ? `<span class="wk-branch">⎇ ${escapeHtml(r.branch)}</span>` : '';
  const n = Number(r.files) || 0;
  const files = `<span class="wk-files">${n} file${n === 1 ? '' : 's'}</span>`;
  return `<div class="wk">
      <div class="wk-top">${label}<span class="wk-repo">${repo}</span></div>
      ${dir}
      <div class="wk-sub">${branch}${files}</div>
    </div>`;
}

function agentCard(a) {
  const cls = a.online ? 'agent agent--online' : 'agent agent--stale';
  const id = escapeHtml((a.agentId || '').slice(0, 8));
  const host = a.host ? `<div><span class="k">host</span> ${escapeHtml(a.host)}</div>` : '';
  const ver = a.version ? `<div><span class="k">ver</span> ${escapeHtml(a.version)}</div>` : '';
  const repos = Array.isArray(a.repos) ? a.repos : [];
  const acts = Array.isArray(a.activity) ? a.activity : [];
  const working = repos.length
    ? `<div class="agent-working"><div class="wk-label">working in</div>${repos.map(workingLine).join('')}</div>`
    : '';
  const activity = acts.length ? `<div class="agent-activity">${acts.map(activityLine).join('')}</div>` : '';
  const idle = !repos.length && !acts.length
    ? '<div class="agent-activity agent-activity--idle">no tracked work</div>'
    : '';
  return `
    <article class="${cls}">
      <div class="agent-head">
        <span class="agent-dot"></span>
        <span class="agent-name">${escapeHtml(a.gitUser || 'unknown')}</span>
      </div>
      <div class="agent-meta">
        ${host}
        ${ver}
        <div><span class="k">id</span> ${id}</div>
      </div>
      ${working}
      ${activity}
      ${idle}
      <div class="agent-seen">${a.online ? 'online' : 'seen'} · ${relTime(a.ageMs)}</div>
    </article>`;
}

function setStatus(state, text) {
  $('pulse').dataset.state = state;
  $('status-text').textContent = text;
}

// ── Conflicts ───────────────────────────────────────────────────────────────
function shortRepo(repoId) {
  return escapeHtml(String(repoId).split('/').slice(-2).join('/'));
}
function fmtRanges(ranges) {
  return (ranges || [])
    .map((r) => (r[0] === r[1] ? `L${r[0]}` : `L${r[0]}–${r[1]}`))
    .join(', ');
}
function conflictCard(c) {
  const parties = (c.parties || [])
    .map(
      (p) =>
        `<span class="cf-party"><b>${escapeHtml(p.gitUser)}</b>` +
        `<span class="cf-branch">⎇ ${escapeHtml(p.branch)}</span>` +
        `<span class="cf-lines">${fmtRanges(p.ranges)}</span></span>`,
    )
    .join('<span class="cf-vs">⨯</span>');
  return `
    <article class="conflict">
      <div class="cf-file"><span class="cf-repo">${shortRepo(c.repoId)}</span> <span class="cf-path">${escapeHtml(c.path)}</span></div>
      <div class="cf-parties">${parties}</div>
    </article>`;
}

function render(data) {
  const online = data.agents.filter((a) => a.online);
  const recent = data.agents.filter((a) => !a.online);

  $('online-count').textContent = data.onlineCount;
  $('total-count').textContent = data.totalCount;
  $('ttl').textContent = `${Math.round(data.ttlMs / 1000)}s`;
  const t = new Date(data.now);
  $('updated').textContent = t.toTimeString().slice(0, 8);

  const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
  $('conflicts-section').hidden = conflicts.length === 0;
  $('conflicts-list').innerHTML = conflicts.map(conflictCard).join('');

  $('online-grid').innerHTML = online.map(agentCard).join('');
  $('online-empty').hidden = online.length > 0;

  $('recent-section').hidden = recent.length === 0;
  $('recent-grid').innerHTML = recent.map(agentCard).join('');

  setStatus('ok', `${data.onlineCount} online`);
}

// ── Polling ─────────────────────────────────────────────────────────────────
async function poll() {
  const key = getKey();
  if (!key) return showGate(false);
  try {
    const res = await fetch('./api/online', { headers: { 'x-cf-key': key } });
    if (res.status === 401) { clearKey(); return showGate(true); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    hideGate();
    render(data);
  } catch (err) {
    setStatus('error', 'offline — retrying');
  }
}

function start() {
  const key = getKey();
  if (!key) return showGate(false);
  hideGate();
  poll();
  if (timer) clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
}

// ── Demo mode ───────────────────────────────────────────────────────────────
// Sample data shaped exactly like /api/online, so it flows through the same
// render() — what you see in the demo is exactly how real data renders.
function demoData() {
  return {
    now: Date.now(),
    ttlMs: 30000,
    onlineCount: 4,
    totalCount: 5,
    conflicts: [
      {
        repoId: 'github.com/acme/checkout-service',
        path: 'src/payment/charge.ts',
        parties: [
          { gitUser: 'alice', branch: 'feat/stripe-retry', ranges: [[42, 58]] },
          { gitUser: 'bob', branch: 'fix/charge-idempotency', ranges: [[50, 63]] },
        ],
      },
      {
        repoId: 'github.com/acme/web',
        path: 'app/routes/checkout.tsx',
        parties: [
          { gitUser: 'carol', branch: 'feat/express-checkout', ranges: [[110, 120]] },
          { gitUser: 'dave', branch: 'refactor/checkout-form', ranges: [[116, 131]] },
        ],
      },
    ],
    agents: [
      {
        agentId: 'demo-alice01', gitUser: 'alice', host: 'alice-mbp', version: '1.3.0',
        online: true, ageMs: 3000,
        repos: [
          { repo: 'acme/checkout-service', branch: 'feat/stripe-retry', dir: '~/work/checkout-service', label: 'payments', files: 7 },
          { repo: 'acme/web', branch: 'main', dir: '~/work/web', label: '', files: 2 },
        ],
        activity: [{ repo: 'checkout-service', branch: 'feat/stripe-retry', runId: '0042-feat-stripe-retry', type: 'feat', phase: 'phase-4-implement' }],
      },
      {
        agentId: 'demo-bob0001', gitUser: 'bob', host: 'bob-linux', version: '1.3.0',
        online: true, ageMs: 9000,
        repos: [{ repo: 'acme/checkout-service', branch: 'fix/charge-idempotency', dir: '~/dev/checkout-service', label: 'payments', files: 4 }],
        activity: [{ repo: 'checkout-service', branch: 'fix/charge-idempotency', runId: '0043-fix-charge-idempotency', type: 'fix', phase: 'phase-7-test' }],
      },
      {
        agentId: 'demo-carol01', gitUser: 'carol', host: 'carol-mbp', version: '1.3.0',
        online: true, ageMs: 14000,
        repos: [{ repo: 'acme/web', branch: 'feat/express-checkout', dir: '~/work/web', label: '', files: 11 }],
        activity: [],
      },
      {
        agentId: 'demo-dave001', gitUser: 'dave', host: 'dave-pc', version: '1.3.0',
        online: true, ageMs: 22000,
        repos: [
          { repo: 'acme/web', branch: 'refactor/checkout-form', dir: '~/code/acme/web', label: 'frontend', files: 9 },
          { repo: 'acme/design-system', branch: 'main', dir: '~/code/acme/design-system', label: '', files: 1 },
        ],
        activity: [{ repo: 'web', branch: 'refactor/checkout-form', runId: '0044-refactor-checkout-form', type: 'refactor', phase: 'phase-5-review' }],
      },
      {
        agentId: 'demo-erin001', gitUser: 'erin', host: 'erin-mbp', version: '1.3.0',
        online: false, ageMs: 95000,
        repos: [{ repo: 'acme/infra', branch: 'chore/bump-deps', dir: '~/work/infra', label: '', files: 3 }],
        activity: [],
      },
    ],
  };
}

function isDemo() {
  return new URLSearchParams(location.search).has('demo');
}
function enterDemo() {
  if (timer) { clearInterval(timer); timer = null; }
  hideGate();
  $('demo-banner').hidden = false;
  $('header-demo').hidden = true;
  $('signout').hidden = true;
  setStatus('ok', 'demo');
  render(demoData());
  if (!isDemo()) history.replaceState(null, '', `${location.pathname}?demo`);
}
function exitDemo() {
  $('demo-banner').hidden = true;
  $('header-demo').hidden = false;
  $('signout').hidden = false;
  history.replaceState(null, '', location.pathname);
  start();
}

// ── Wire up ─────────────────────────────────────────────────────────────────
$('poll').textContent = String(POLL_MS / 1000);

$('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const k = $('gate-key').value.trim();
  if (!k) return;
  setKey(k);
  $('gate-key').value = '';
  start();
});

$('signout').addEventListener('click', () => { clearKey(); showGate(false); });
$('gate-demo').addEventListener('click', enterDemo);
$('header-demo').addEventListener('click', enterDemo);
$('demo-exit').addEventListener('click', exitDemo);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !isDemo() && getKey()) poll();
});

if (isDemo()) enterDemo();
else start();
