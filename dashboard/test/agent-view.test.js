'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  activityLine,
  agentActivityHtml,
  agentCard,
  agentMeta,
  agentWorkingHtml,
  workingLine
} = require('../public/agent-view.js');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function dependencies(expanded = []) {
  return {
    escapeHtml,
    expandedAgents: new Set(expanded),
    relTime: (age) => `age-${age}`,
    userDot: () => '[dot]'
  };
}

test('working line renders safe names, labels, branches, files, and fallbacks', () => {
  assert.match(workingLine(dependencies(), {
    repo: 'org/api', dir: '/workspace/<api>', label: '<primary>',
    branch: 'feature/<x>', files: '3'
  }), /&lt;api&gt;.*&lt;primary&gt;.*feature\/&lt;x&gt;.*3f/);
  assert.match(workingLine(dependencies(), { repo: 'org/fallback', files: 'bad' }),
    /org\/fallback.*0f/);
  assert.match(workingLine(dependencies(), {}), />·<.*0f/);
});

test('activity line handles branch, run, phase, and empty fields', () => {
  assert.match(activityLine(dependencies(), {
    repo: '<api>', branch: '<main>', runId: '<run>', phase: '<prove>'
  }), /&lt;api&gt;.*&lt;main&gt;.*&lt;run&gt;.*&lt;prove&gt;/);
  assert.doesNotMatch(activityLine(dependencies(), { repo: 'api', runId: 'run' }),
    /act-branch/);
  assert.doesNotMatch(activityLine(dependencies(), {}), /act-run|act-branch/);
});

test('working section limits repositories and toggles expanded copy', () => {
  const repos = Array.from({ length: 8 }, (_, index) => ({ repo: `repo-${index}` }));
  const collapsed = agentWorkingHtml(dependencies(), { agentId: '<agent>' }, repos);
  assert.match(collapsed, /working in · 8 repos/);
  assert.match(collapsed, /\+ 2 more/);
  assert.doesNotMatch(collapsed, /repo-7/);
  assert.match(collapsed, /data-agent="&lt;agent&gt;"/);
  const expanded = agentWorkingHtml(dependencies(['agent']), { agentId: 'agent' }, repos);
  assert.match(expanded, /repo-7/);
  assert.match(expanded, /show less/);
  assert.match(agentWorkingHtml(dependencies(), { agentId: 'one' }, [{ repo: 'one' }]),
    /1 repo<\/div>/);
  assert.equal(agentWorkingHtml(dependencies(), {}, []), '');
});

test('activity section distinguishes activity, working-only, and idle agents', () => {
  assert.match(agentActivityHtml(dependencies(), [], [{ repo: 'api' }]),
    /agent-activity.*api/);
  assert.equal(agentActivityHtml(dependencies(), [{ repo: 'api' }], []), '');
  assert.match(agentActivityHtml(dependencies(), [], []), /no tracked work/);
});

test('agent metadata omits empty values and truncates identity', () => {
  assert.equal(agentMeta(dependencies(), {
    host: '<host>', version: '<1>', agentId: '1234567890'
  }), '&lt;host&gt; · v&lt;1&gt; · 12345678');
  assert.equal(agentMeta(dependencies(), {}), '');
});

test('agent card renders online, stale, unknown, work, activity, and relative time', () => {
  const online = agentCard(dependencies(), {
    online: true, agentId: 'agent-123', gitUser: '<alice>', host: 'host', version: '1',
    ageMs: 10, repos: [{ repo: 'api' }], activity: [{ repo: 'api', runId: 'run' }]
  });
  assert.match(online, /agent--online/);
  assert.match(online, /\[dot\]&lt;alice&gt;/);
  assert.match(online, /online · age-10/);
  assert.match(online, /working in/);
  assert.match(online, /\/dev run/);

  const stale = agentCard(dependencies(), {
    online: false, ageMs: 20, repos: null, activity: null
  });
  assert.match(stale, /agent--stale/);
  assert.match(stale, /\[dot\]unknown/);
  assert.match(stale, /no tracked work/);
  assert.match(stale, /seen · age-20/);
});

test('classic browser script exposes the agent view API', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(join(__dirname, '..', 'public', 'agent-view.js'), 'utf8'),
    context, { filename: 'agent-view.js' });
  assert.equal(vm.runInContext('typeof FoundationAgentView.agentCard', context),
    'function');
});
