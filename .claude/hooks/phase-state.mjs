import { join } from "node:path";

export function recordedPhaseContext(context) {
  try {
    const logs = join(context.projectRoot, ".foundation", "logs");
    if (!context.pathExists(logs)) return "";
    let newest = null;
    for (const entry of context.readDirectory(logs)) {
      if (!entry.isDirectory()) continue;
      const path = join(logs, entry.name, "phase-context.jsonl");
      if (!context.pathExists(path)) continue;
      const last = context.readText(path, "utf8").split("\n").filter(Boolean).at(-1);
      if (!last) continue;
      let row;
      try { row = JSON.parse(last); } catch { continue; }
      const at = Date.parse(row?.timestamp || "");
      if (!Number.isFinite(at)) continue;
      if (!newest || at > newest.at) newest = {
        at, phase: String(row.phase || ""), changeId: String(row.changeId || "")
      };
    }
    if (!newest || context.nowMs() - newest.at > context.freshnessMs) return "";
    return newest;
  } catch {
    return null;
  }
}

export function recordedPhase(context) {
  return recordedPhaseContext(context)?.phase || "";
}
