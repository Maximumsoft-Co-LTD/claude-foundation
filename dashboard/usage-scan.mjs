#!/usr/bin/env node

import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  renameSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY_MS = 86400000;

export function localDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function assistantUsage(row) {
  const message = row && typeof row.message === 'object' ? row.message : null;
  const usage = message && typeof message.usage === 'object' ? message.usage : null;
  return row?.type === 'assistant' && message?.role === 'assistant' && usage
    ? { message, usage } : null;
}

export function transcriptProject(cwd) {
  const normalized = typeof cwd === 'string' ? cwd.replace(/[\\/]+$/, '') : '';
  return normalized ? normalized.split(/[\\/]/).at(-1) : '';
}

export function messageTools(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block?.type === 'tool_use' && block.name)
    .map((block) => String(block.name));
}

export function nonNegativeUsage(value) {
  return Math.max(0, Number(value || 0));
}

function discoverJsonl(root, cutoffMs, cap) {
  const files = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        let stat;
        try { stat = statSync(path); } catch { continue; }
        if (stat.mtimeMs >= cutoffMs) files.push({ path: resolve(path), stat });
      }
    }
  }
  walk(root);
  return files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, cap);
}

function readState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value.version === 1 ? value : null;
  } catch { return null; }
}

function writeState(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}

function readCompleteLines(path, offset, onLine) {
  const descriptor = openSync(path, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let position = offset;
  let committed = offset;
  let carry = Buffer.alloc(0);
  try {
    for (;;) {
      const count = readSync(descriptor, chunk, 0, chunk.length, position);
      if (!count) break;
      position += count;
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, count)]) : chunk.subarray(0, count);
      let start = 0;
      for (;;) {
        const newline = data.indexOf(10, start);
        if (newline < 0) break;
        const line = data.subarray(start, newline).toString('utf8').trim();
        if (line) onLine(line);
        start = newline + 1;
        committed += newline + 1;
      }
      carry = Buffer.from(data.subarray(start));
      committed = position - carry.length;
    }
  } finally {
    closeSync(descriptor);
  }
  return committed;
}

export function messageRecord(row, source, fallbackId) {
  const assistant = assistantUsage(row);
  if (!assistant) return null;
  const { message, usage } = assistant;
  const model = String(message.model || '');
  if (!model || model === '<synthetic>') return null;
  const date = localDate(row.timestamp);
  if (!date) return null;
  return {
    id: String(row.requestId || row.request_id || message.id || row.uuid || fallbackId),
    source, sources: [source], date, timestamp: Date.parse(row.timestamp), model,
    project: transcriptProject(row.cwd),
    input: nonNegativeUsage(usage.input_tokens),
    output: nonNegativeUsage(usage.output_tokens),
    cacheCreate: nonNegativeUsage(usage.cache_creation_input_tokens),
    cacheRead: nonNegativeUsage(usage.cache_read_input_tokens),
    tools: messageTools(message.content),
  };
}

function emptyState(days) {
  return { version: 1, days, files: {}, messages: {} };
}

export function scanUsage({ projectsDir, statePath, days = 30, fileCap = 4000, now = Date.now() }) {
  const cutoffMs = now - days * DAY_MS;
  const cutoffDate = localDate(cutoffMs);
  const files = discoverJsonl(projectsDir, cutoffMs, fileCap);
  let state = readState(statePath) || emptyState(days);
  if (state.days !== days) state = emptyState(days);

  // A rewrite/truncation invalidates source ownership. Rebuilding is rare and
  // safer than retaining messages that no longer exist.
  const mustRebuild = files.some(({ path, stat }) => {
    const prior = state.files[path];
    return prior && (stat.size < prior.offset || (stat.mtimeMs !== prior.mtimeMs && stat.size === prior.offset));
  });
  if (mustRebuild) state = emptyState(days);

  const activePaths = new Set(files.map((file) => file.path));
  for (const path of Object.keys(state.files)) if (!activePaths.has(path)) delete state.files[path];
  for (const [id, message] of Object.entries(state.messages)) {
    message.sources = (message.sources || [message.source]).filter((source) => activePaths.has(source));
    message.source = message.sources[0] || message.source;
    if (message.date < cutoffDate || message.sources.length === 0) delete state.messages[id];
  }

  let scannedBytes = 0;
  for (const { path, stat } of files) {
    const prior = state.files[path] || { offset: 0, sessions: {} };
    const session = { ...prior, sessions: prior.sessions || {} };
    const start = Math.min(session.offset || 0, stat.size);
    let ordinal = 0;
    session.offset = readCompleteLines(path, start, (line) => {
      let row;
      try { row = JSON.parse(line); } catch { return; }
      const record = messageRecord(row, path, `${path}:${start}:${ordinal++}`);
      if (!record || record.date < cutoffDate) return;
      const daily = session.sessions[record.date] || { first: record.timestamp, last: record.timestamp };
      daily.first = Math.min(daily.first, record.timestamp);
      daily.last = Math.max(daily.last, record.timestamp);
      session.sessions[record.date] = daily;
      if (!state.messages[record.id]) state.messages[record.id] = record;
      else if (!(state.messages[record.id].sources || []).includes(path)) {
        state.messages[record.id].sources = [...(state.messages[record.id].sources || [state.messages[record.id].source]), path];
      }
    });
    scannedBytes += Math.max(0, session.offset - start);
    session.mtimeMs = stat.mtimeMs;
    session.size = stat.size;
    for (const date of Object.keys(session.sessions)) if (date < cutoffDate) delete session.sessions[date];
    state.files[path] = session;
  }

  const usage = new Map();
  const tools = new Map();
  for (const message of Object.values(state.messages)) {
    const key = `${message.date}\0${message.model}\0${message.project}`;
    const row = usage.get(key) || {
      date: message.date, model: message.model, project: message.project,
      input: 0, output: 0, cacheCreate: 0, cacheRead: 0, count: 0,
    };
    row.input += message.input; row.output += message.output;
    row.cacheCreate += message.cacheCreate; row.cacheRead += message.cacheRead; row.count += 1;
    usage.set(key, row);
    for (const tool of message.tools) {
      const toolKey = `${message.date}\0${tool}`;
      tools.set(toolKey, (tools.get(toolKey) || 0) + 1);
    }
  }
  const sessionsByDate = new Map();
  for (const file of Object.values(state.files)) {
    for (const [date, times] of Object.entries(file.sessions || {})) {
      const row = sessionsByDate.get(date) || { date, count: 0, seconds: 0 };
      row.count += 1;
      row.seconds += Math.max(0, Math.round((times.last - times.first) / 1000));
      sessionsByDate.set(date, row);
    }
  }
  const result = {
    usage: [...usage.values()].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model)),
    sessions: [...sessionsByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    tools: [...tools].map(([key, count]) => {
      const [date, tool] = key.split('\0'); return { date, tool, count };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.tool.localeCompare(b.tool)),
    scannedBytes,
  };
  writeState(statePath, state);
  return result;
}

function main() {
  const [projectsDir, statePath, daysRaw, capRaw] = process.argv.slice(2);
  if (!projectsDir || !statePath) {
    console.error('usage: usage-scan.mjs <projects-dir> <state-file> [days] [file-cap]');
    process.exit(2);
  }
  const result = scanUsage({
    projectsDir, statePath,
    days: Math.max(1, Number(daysRaw || 30)),
    fileCap: Math.max(1, Number(capRaw || 4000)),
  });
  process.stdout.write(`${JSON.stringify(result.usage)}\n${JSON.stringify(result.sessions)}\n${JSON.stringify(result.tools)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
