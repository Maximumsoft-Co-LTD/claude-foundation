'use strict';

const MAX_FIELD_LEN = 200;
const ARTIFACT_KEYS = ['spec', 'plan', 'test-plan', 'tests', 'review', 'security', 'retro'];

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clean(v, max = MAX_FIELD_LEN) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max).trim();
}

function cleanArtifacts(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const key of ARTIFACT_KEYS) {
      const value = toInt(raw[key], 0);
      if (value > 0) out[key] = value;
    }
  }
  return out;
}

function cleanOperationMs(raw) {
  const out = {};
  for (const phase of ['change', 'build', 'prove', 'land']) {
    const value = raw && raw[phase];
    if (Number.isSafeInteger(value) && value >= 0) out[phase] = value;
  }
  return out;
}

function cleanRuns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 300).map((run) => ({
    id: clean(run && run.id, 80),
    type: clean(run && run.type, 20),
    repo: clean(run && run.repo, 120),
    repoId: clean(run && run.repoId, 200),
    branch: clean(run && run.branch, 120),
    owner: clean(run && run.owner, 80),
    ownerEmail: clean(run && run.ownerEmail, 120),
    size: clean(run && run.size, 8),
    phase: clean(run && run.phase, 40),
    started: Math.max(0, toInt(run && run.started, 0)),
    finished: Math.max(0, toInt(run && run.finished, 0)),
    done: !!(run && run.done),
    art: cleanArtifacts(run && run.art),
    operationMs: cleanOperationMs(run && run.operationMs),
  })).filter((run) => run.id);
}

function cleanUsage(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 3000).map((usage) => ({
    date: clean(usage && usage.date, 10),
    model: clean(usage && usage.model, 80),
    project: clean(usage && usage.project, 80),
    input: Math.max(0, toInt(usage && usage.input, 0)),
    output: Math.max(0, toInt(usage && usage.output, 0)),
    cacheCreate: Math.max(0, toInt(usage && usage.cacheCreate, 0)),
    cacheRead: Math.max(0, toInt(usage && usage.cacheRead, 0)),
    count: Math.max(0, toInt(usage && usage.count, 0)),
  })).filter((usage) => /^\d{4}-\d{2}-\d{2}$/.test(usage.date) && usage.model);
}

function cleanSessions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).map((session) => ({
    date: clean(session && session.date, 10),
    count: Math.max(0, toInt(session && session.count, 0)),
    seconds: Math.max(0, toInt(session && session.seconds, 0)),
  })).filter((session) => /^\d{4}-\d{2}-\d{2}$/.test(session.date));
}

function cleanDateCounts(raw, field) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20)
    .map((count) => ({
      date: clean(count && count.date, 10),
      [field]: Math.max(0, toInt(count && count[field], 0)),
    }))
    .filter((count) => /^\d{4}-\d{2}-\d{2}$/.test(count.date));
}

function cleanTools(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 3000).map((tool) => ({
    date: clean(tool && tool.date, 10),
    tool: clean(tool && tool.tool, 60),
    count: Math.max(0, toInt(tool && tool.count, 0)),
  })).filter((tool) => tool.tool && /^\d{4}-\d{2}-\d{2}$/.test(tool.date));
}

function cleanRanges(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const range of raw.slice(0, 200)) {
    if (!Array.isArray(range) || range.length < 2) continue;
    const start = Math.max(0, Math.floor(Number(range[0])) || 0);
    const end = Math.max(start, Math.floor(Number(range[1])) || start);
    out.push([start, end]);
  }
  return out;
}

function hasChangeActivity(repo) {
  return Boolean(repo.repoId && (
    repo.files.length || repo.work.length || repo.commits.length || repo.pushes.length ||
    repo.fuOpen || repo.fuClosed
  ));
}

function cleanChanges(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).map((repo) => ({
    repoId: clean(repo && repo.repoId, 200),
    branch: clean(repo && repo.branch, 120),
    path: clean(repo && repo.path, 300),
    label: clean(repo && repo.label, 80),
    fuOpen: Math.max(0, toInt(repo && repo.fuOpen, 0)),
    fuClosed: Math.max(0, toInt(repo && repo.fuClosed, 0)),
    commits: cleanDateCounts(repo && repo.commits, 'n'),
    pushes: cleanDateCounts(repo && repo.pushes, 'n'),
    work: Array.isArray(repo && repo.work)
      ? repo.work.slice(0, 20).map((work) => ({
          date: clean(work && work.date, 10),
          commits: Math.max(0, toInt(work && work.commits, 0)),
          added: Math.max(0, toInt(work && work.added, 0)),
          deleted: Math.max(0, toInt(work && work.deleted, 0)),
        })).filter((work) => /^\d{4}-\d{2}-\d{2}$/.test(work.date))
      : [],
    files: Array.isArray(repo && repo.files)
      ? repo.files.slice(0, 100)
          .map((file) => ({ path: clean(file && file.path, 300), ranges: cleanRanges(file && file.ranges) }))
          .filter((file) => file.path && file.ranges.length)
      : [],
  })).filter(hasChangeActivity);
}

module.exports = {
  clean, cleanArtifacts, cleanChanges, cleanDateCounts, cleanRanges, cleanRuns,
  cleanSessions, cleanTools, cleanUsage, hasChangeActivity, toInt,
};
