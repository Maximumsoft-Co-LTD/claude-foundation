#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import process from "node:process";

const STORAGE = /(?:^|[\s"'])[^\s"']*reliability_probe(?:["'])?\s+soak(?:\s|$)/;
const MIXED = /(?:^|[\s"'])[^\s"']*mixed-soak-v2\.mjs(?:["'])?(?:\s|$)/;

export function parseProcessTable(text) {
  return text.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return [];
    return [{
      pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]),
      elapsed: match[4], command: match[5],
    }];
  });
}

export function detectSoakProcesses(processes) {
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const classified = processes.flatMap((item) => {
    if (/^(?:\S*\/)?(?:grep|rg|egrep|fgrep)\s/.test(item.command)
        || /^(?:\S*\/)?rtk\s+(?:proxy\s+)?(?:grep|rg)\s/.test(item.command)) return [];
    const kind = STORAGE.test(item.command) ? "storage-replay-soak"
      : MIXED.test(item.command) ? "mixed-resource-soak" : null;
    return kind ? [{ ...item, kind }] : [];
  });
  return classified.filter((candidate) => !classified.some((other) =>
    other.kind === candidate.kind && other.pid !== candidate.pid
      && hasAncestor(other, candidate.pid, byPid)))
    .map((workload) => {
      const matcher = workload.kind === "storage-replay-soak" ? STORAGE : MIXED;
      const parentChain = ancestors(workload, byPid);
      const relevantParents = parentChain
        .filter((item) => matcher.test(item.command))
        .map(({ pid, ppid, pgid, elapsed, command }) => ({ pid, ppid, pgid, elapsed, command }));
      return { ...workload, parentChain: relevantParents, output: outputPath({ ...workload, parentChain: relevantParents }) };
    })
    .sort((left, right) => left.pid - right.pid);
}

function hasAncestor(process_, ancestorPid, byPid) {
  let cursor = process_;
  const seen = new Set();
  while (cursor && !seen.has(cursor.pid)) {
    if (cursor.ppid === ancestorPid) return true;
    seen.add(cursor.pid);
    cursor = byPid.get(cursor.ppid);
  }
  return false;
}

function ancestors(process_, byPid) {
  const result = [];
  const seen = new Set([process_.pid]);
  let cursor = byPid.get(process_.ppid);
  while (cursor && !seen.has(cursor.pid)) {
    result.push(cursor);
    seen.add(cursor.pid);
    cursor = byPid.get(cursor.ppid);
  }
  return result;
}

function outputPath(workload) {
  if (workload.kind === "storage-replay-soak") {
    const wrapper = [workload, ...workload.parentChain].find((item) => /\s>\s*/.test(item.command));
    return wrapper?.command.match(/\s>\s*(?:"([^"]+)"|'([^']+)'|(\S+))/)?.slice(1).find(Boolean) ?? null;
  }
  return workload.command.match(/mixed-soak-v2\.mjs(?:["'])?\s+\d+\s+(?:"([^"]+)"|'([^']+)'|(\S+))/)?.slice(1).find(Boolean) ?? null;
}

export function currentSoakProcesses() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,etime=,command="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ps failed: ${result.stderr}`);
  return detectSoakProcesses(parseProcessTable(result.stdout));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workloads = currentSoakProcesses();
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), running: workloads.length > 0, workloads }, null, 2));
}
