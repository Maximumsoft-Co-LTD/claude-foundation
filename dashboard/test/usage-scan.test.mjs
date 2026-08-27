import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, appendFileSync, readFileSync, rmSync, unlinkSync, utimesSync,
  writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assistantUsage,
  localDate,
  messageRecord,
  messageTools,
  nonNegativeUsage,
  scanUsage,
  transcriptProject,
} from '../usage-scan.mjs';

function assistant(id, timestamp, cwd, input, tools = []) {
  return JSON.stringify({
    type: 'assistant', timestamp, cwd,
    message: {
      id, role: 'assistant', model: 'claude-sonnet-test',
      usage: { input_tokens: input, output_tokens: 1 },
      content: tools.map((name, index) => ({ type: 'tool_use', id: `tool-${index}`, name, input: {} })),
    },
  });
}

test('incremental scan reads only appended bytes and keeps date-keyed tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'cf-usage-scan-'));
  try {
    const projects = join(root, 'projects');
    const transcript = join(projects, 'session.jsonl');
    const state = join(root, 'state.json');
    mkdirSync(projects);
    writeFileSync(transcript, `${assistant('m1', '2026-08-02T01:00:00.000Z', '/work/a"b', 10, ['Read'])}\n`);
    const first = scanUsage({ projectsDir: projects, statePath: state, days: 30, now: Date.parse('2026-08-03T00:00:00Z') });
    assert.ok(first.scannedBytes > 0);
    assert.equal(first.usage[0].project, 'a"b');
    assert.deepEqual(first.tools, [{ date: '2026-08-02', tool: 'Read', count: 1 }]);

    const appended = `${assistant('m2', '2026-08-02T02:00:00.000Z', '/work/demo', 20, ['Write'])}\n`;
    appendFileSync(transcript, appended);
    const second = scanUsage({ projectsDir: projects, statePath: state, days: 30, now: Date.parse('2026-08-03T00:00:00Z') });
    assert.equal(second.scannedBytes, Buffer.byteLength(appended));
    assert.equal(second.usage.reduce((sum, row) => sum + row.input, 0), 30);
    assert.deepEqual(second.tools.map((row) => row.tool), ['Read', 'Write']);

    const unchanged = scanUsage({ projectsDir: projects, statePath: state, days: 30, now: Date.parse('2026-08-03T00:00:00Z') });
    assert.equal(unchanged.scannedBytes, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('message helpers classify assistant usage, projects, tools, and counters', () => {
  assert.equal(assistantUsage(null), null);
  assert.equal(assistantUsage({ type: 'user', message: { role: 'assistant', usage: {} } }), null);
  assert.equal(assistantUsage({ type: 'assistant', message: { role: 'user', usage: {} } }), null);
  assert.equal(assistantUsage({ type: 'assistant', message: { role: 'assistant' } }), null);
  assert.deepEqual(assistantUsage({
    type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 1 } }
  }).usage, { input_tokens: 1 });
  assert.equal(transcriptProject('/work/demo///'), 'demo');
  assert.equal(transcriptProject('C:\\work\\demo\\'), 'demo');
  assert.equal(transcriptProject(null), '');
  assert.deepEqual(messageTools(null), []);
  assert.deepEqual(messageTools([
    { type: 'tool_use', name: 'Read' },
    { type: 'text', name: 'ignored' }, { type: 'tool_use' }, null,
    { type: 'tool_use', name: 42 }
  ]), ['Read', '42']);
  assert.equal(nonNegativeUsage(-3), 0);
  assert.equal(nonNegativeUsage('4'), 4);
  assert.equal(nonNegativeUsage(undefined), 0);
  assert.equal(localDate('invalid'), null);
});

test('messageRecord rejects non-attributable rows and preserves all usage fields', () => {
  const base = {
    type: 'assistant', timestamp: '2026-08-02T01:00:00.000Z', cwd: '/work/demo/',
    message: {
      role: 'assistant', model: 'claude-test', id: 'message-id',
      usage: {
        input_tokens: 10, output_tokens: 2,
        cache_creation_input_tokens: 3, cache_read_input_tokens: 4
      },
      content: [{ type: 'tool_use', name: 'Read' }]
    }
  };
  assert.equal(messageRecord({ ...base, type: 'user' }, 'source', 'fallback'), null);
  assert.equal(messageRecord({ ...base, message: { ...base.message, model: '' } },
    'source', 'fallback'), null);
  assert.equal(messageRecord({ ...base, message: { ...base.message, model: '<synthetic>' } },
    'source', 'fallback'), null);
  assert.equal(messageRecord({ ...base, timestamp: 'invalid' }, 'source', 'fallback'), null);
  assert.deepEqual(messageRecord(base, 'source', 'fallback'), {
    id: 'message-id', source: 'source', sources: ['source'],
    date: localDate(base.timestamp), timestamp: Date.parse(base.timestamp),
    model: 'claude-test', project: 'demo', input: 10, output: 2,
    cacheCreate: 3, cacheRead: 4, tools: ['Read']
  });
  const identifiers = [
    [{ requestId: 'request' }, 'request'],
    [{ request_id: 'request-snake' }, 'request-snake'],
    [{ message: { id: null }, uuid: 'uuid' }, 'uuid'],
    [{ message: { id: null }, uuid: null }, 'fallback']
  ];
  for (const [changes, expected] of identifiers) {
    const row = {
      ...base, ...changes,
      message: { ...base.message, ...(changes.message || {}) }
    };
    assert.equal(messageRecord(row, 'source', 'fallback').id, expected);
  }
});

test('scanner rebuilds changed sources and prunes stale duplicate ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'cf-usage-rebuild-'));
  try {
    const projects = join(root, 'projects');
    const nested = join(projects, 'nested');
    const firstPath = join(nested, 'first.jsonl');
    const secondPath = join(projects, 'second.jsonl');
    const statePath = join(root, 'state.json');
    mkdirSync(nested, { recursive: true });
    const now = Date.parse('2026-08-03T00:00:00Z');
    const shared = assistant('shared', '2026-08-02T01:00:00.000Z', '/work/demo', 5);
    writeFileSync(firstPath, [
      'not-json',
      assistant('old', '2026-06-01T01:00:00.000Z', '/work/old', 99),
      shared,
      assistant('partial', '2026-08-02T02:00:00.000Z', '/work/demo', 7)
    ].join('\n'));
    writeFileSync(secondPath, `${shared}\n${
      assistant('second', '2026-08-02T03:00:00.000Z', '/work/demo', 11)}\n`);
    writeFileSync(statePath, JSON.stringify({ version: 2, days: 30 }));

    const first = scanUsage({ projectsDir: projects, statePath, days: 30, now });
    assert.equal(first.usage[0].count, 2, 'shared request is counted once across two files');
    assert.equal(first.usage[0].input, 16);
    assert.equal(first.sessions[0].count, 2);

    const legacy = JSON.parse(readFileSync(statePath, 'utf8'));
    delete legacy.messages.shared.sources;
    legacy.messages.shared.source = firstPath;
    delete legacy.files[firstPath].sessions;
    legacy.files[secondPath].sessions = {
      '2026-01-01': { first: now, last: now }
    };
    writeFileSync(statePath, JSON.stringify(legacy));
    const normalized = scanUsage({ projectsDir: projects, statePath, days: 30, now });
    assert.equal(normalized.sessions.some((row) => row.date === '2026-01-01'), false);

    unlinkSync(secondPath);
    const pruned = scanUsage({ projectsDir: projects, statePath, days: 30, now });
    assert.equal(pruned.usage[0].count, 1);
    assert.equal(pruned.usage[0].input, 5);

    const replacement = `${assistant(
      'replacement', '2026-08-02T04:00:00.000Z', '/work/new', 3)}\n`;
    writeFileSync(firstPath, replacement);
    utimesSync(firstPath, new Date(now - 1000), new Date(now - 1000));
    const rebuilt = scanUsage({ projectsDir: projects, statePath, days: 30, now });
    assert.equal(rebuilt.usage[0].project, 'new');
    assert.equal(rebuilt.usage[0].input, 3);

    const resetWindow = scanUsage({ projectsDir: projects, statePath, days: 7, now });
    assert.equal(resetWindow.usage[0].input, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('usage scanner CLI validates arguments and emits its three datasets', () => {
  const root = mkdtempSync(join(tmpdir(), 'cf-usage-cli-'));
  try {
    const projects = join(root, 'projects');
    const transcript = join(projects, 'session.jsonl');
    const statePath = join(root, 'state.json');
    mkdirSync(projects);
    writeFileSync(transcript, `${assistant(
      'cli', new Date().toISOString(), '/work/cli', 2, ['Read'])}\n`);
    const script = new URL('../usage-scan.mjs', import.meta.url).pathname;
    const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /usage: usage-scan/);

    const valid = spawnSync(process.execPath,
      [script, projects, statePath, '1', '5'], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    const rows = valid.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 3);
    assert.equal(rows[0][0].project, 'cli');
    assert.equal(rows[2][0].tool, 'Read');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
