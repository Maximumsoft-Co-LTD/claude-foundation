import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanUsage } from '../usage-scan.mjs';

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
