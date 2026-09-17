import {
  lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

const MARKER = "<!-- change-loop:generated-investigation-report:v1 -->";
const rows = (value) => Array.isArray(value) ? value : [];
const escape = (value) => String(value ?? "").replace(/[\\`*_[\]<>]/g, "\\$&");
export const isInvestigationReport = (path) =>
  /^openspec\/investigations\/[^/]+\.report\.md$/.test(path);

export function isOwnedInvestigationReport(root, path) {
  if (!isInvestigationReport(path)) return false;
  try {
    const absolute = join(realpathSync(root), path);
    return realpathSync(absolute) === absolute && lstatSync(absolute).isFile() &&
      readFileSync(absolute, "utf8").startsWith(MARKER);
  } catch { return false; }
}

export function investigationReportPaths(root) {
  const directory = join(root, "openspec", "investigations");
  try {
    return readdirSync(directory).map((name) => `openspec/investigations/${name}`)
      .filter(isInvestigationReport);
  } catch { return []; }
}

const labels = {
  en: {
    title: "Investigation report", status: "Status", current: "Current conclusion",
    incomplete: "Incomplete — review the next action before using this conclusion",
    problem: "Problem", recommendation: "Recommendation and reasons", none: "Not recorded",
    facts: "Source-grounded facts", unverified: "Recorded facts — validation is incomplete",
    hypotheses: "Hypotheses and evidence", options: "Options and tradeoffs",
    decisions: "Decisions", unknowns: "Unknowns and remaining work", sources: "Sources",
    next: "Next action", ready: "Ready to propose a Change; user intent is still required",
    noChange: "Investigation complete; no Change recommended", resume: "Agent resume command",
    updated: "Updated", evidence: "Evidence", rejected: "Not selected", choice: "Choice",
    open: "Open", supported: "Supported", falsified: "Falsified", resolved: "Resolved",
    research: "Continue investigating", user: "User decision required", findings: "Findings",
    tradeoffs: "Tradeoffs", prototype: "Prototype (not proof)"
  },
  th: {
    title: "รายงานการสำรวจปัญหา", status: "สถานะ", current: "ข้อสรุปปัจจุบัน",
    incomplete: "ยังไม่สมบูรณ์ — ตรวจขั้นตอนถัดไปก่อนใช้ข้อสรุปนี้",
    problem: "ปัญหา", recommendation: "ข้อเสนอแนะและเหตุผล", none: "ยังไม่ได้บันทึก",
    facts: "ข้อเท็จจริงที่มีแหล่งอ้างอิง", unverified: "ข้อเท็จจริงที่บันทึกไว้ — ยังตรวจสอบไม่ครบ",
    hypotheses: "สมมติฐานและหลักฐาน", options: "ทางเลือกและข้อแลกเปลี่ยน",
    decisions: "การตัดสินใจ", unknowns: "สิ่งที่ยังไม่รู้และงานที่เหลือ", sources: "แหล่งอ้างอิง",
    next: "ขั้นตอนถัดไป", ready: "พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้",
    noChange: "สำรวจเสร็จแล้วและไม่แนะนำให้ทำ Change", resume: "คำสั่งที่ agent ใช้ทำต่อ",
    updated: "อัปเดต", evidence: "หลักฐาน", rejected: "ไม่เลือก", choice: "ตัวเลือก",
    open: "ยังไม่สรุป", supported: "มีหลักฐานสนับสนุน", falsified: "มีหลักฐานหักล้าง", resolved: "ตัดสินใจแล้ว",
    research: "ต้องสำรวจต่อ", user: "ต้องการการตัดสินใจจากผู้ใช้", findings: "ข้อค้นพบ",
    tradeoffs: "ข้อแลกเปลี่ยน", prototype: "ต้นแบบ (ไม่ใช่หลักฐานพิสูจน์)"
  }
};

export function renderInvestigationReport({ record, state, projectRoot, sourceRoot, path,
  validationIssues = [] }) {
  const language = String(record.language || (/\p{Script=Thai}/u.test(record.problem || "") ? "th" : "en"));
  const l = labels[language.toLowerCase().startsWith("th") ? "th" : "en"];
  const complete = state.action.action === "DONE";
  const link = (source) => {
    const target = relative(dirname(join(projectRoot, path)), resolve(sourceRoot || projectRoot, source))
      .replaceAll("\\", "/");
    return `[${escape(source)}](<${encodeURI(target).replace(/[<>]/g, (c) => encodeURIComponent(c))}>)`;
  };
  const list = (items) => rows(items).length ? rows(items).map((item) => `- ${item}`).join("\n") : l.none;
  const section = (title, body) => `\n## ${title}\n\n${body}\n`;
  const factsValid = !validationIssues.length && state.action.boundary !== "investigation-record" &&
    state.sourceInventory?.sources?.length > 0;
  let output = `${MARKER}\n# ${l.title}: ${escape(record.id)}\n\n` +
    `**${l.status}:** ${complete ? l.current : l.incomplete}\n\n` +
    `${l.updated}: ${escape(state.updatedAt)} · ${escape(state.stateDigest)}\n`;
  output += section(l.problem, escape(record.problem));
  output += section(l.current, escape(state.conclusion?.summary || l.none));
  output += section(l.recommendation, state.selection
    ? `${escape(state.selection.optionKey)} — ${escape(state.selection.reason)}\n\n` +
      list(rows(state.selection.rejected).map((row) => `${l.rejected}: ${escape(row.optionKey)} — ${escape(row.reason)}`))
    : escape(state.changeIntent || state.conclusion?.summary || l.none));
  output += section(factsValid ? l.facts : l.unverified, list(rows(state.facts).map((fact) =>
    `**${escape(fact.key)}:** ${escape(fact.statement)} (${rows(fact.sources).map(link).join(", ")})`)));
  output += section(l.hypotheses, list(rows(state.hypotheses).map((row) =>
    `**${escape(row.key)} — ${l[row.status] || escape(row.status)}:** ${escape(row.statement)}; ` +
    `${l.evidence}: ${rows(row.factKeys).map(escape).join(", ") || l.none}`)));
  if (rows(state.options).length) output += section(l.options, rows(state.options).map((option) =>
    `### ${escape(option.key)}\n\n${escape(option.summary)}\n\n` +
    `${l.findings}:\n\n${list(rows(option.findings).map(escape))}\n\n` +
    `${l.tradeoffs}:\n\n${list(rows(option.tradeoffs).map(escape))}\n\n` +
    `${l.sources}: ${rows(option.sources).map(link).join(", ")}\n\n` +
    `${l.prototype}: ${rows(option.prototypePaths).map(escape).join(", ") || l.none}`
  ).join("\n\n"));
  output += section(l.decisions, list(rows(state.decisions).map((row) =>
    `**${escape(row.key)} — ${l[row.status] || escape(row.status)}:** ${escape(row.question || row.choice)}\n` +
    `  ${l.choice}: ${rows(row.alternatives).map(escape).join(" / ") || escape(row.choice)}; ` +
    `${l.recommendation}: ${escape(row.recommended || row.reason)}; ` +
    `${l.evidence}: ${rows(row.recommendationFactKeys).map(escape).join(", ") || l.none}`)));
  output += section(l.unknowns, list([
    ...rows(state.hypotheses).filter((row) => row.status === "open").map((row) => escape(row.statement)),
    ...rows(state.action.investigation?.issues).map(escape),
    ...rows(validationIssues).filter((issue) => !rows(state.action.investigation?.issues).includes(issue)).map(escape),
    ...rows(state.action.investigation?.paths).map(link),
    ...rows(state.decisions).filter((row) => row.status === "open").map((row) => escape(row.question))
  ]));
  output += section(l.sources, list(rows(state.sourceInventory?.sources).map((row) => link(row.path))));
  const next = complete ? state.conclusion?.status === "ready-for-change" ? l.ready
    : state.conclusion?.status === "not-worth-changing" ? l.noChange : l.user
    : state.action.action === "ASK_USER" ? l.user : l.research;
  output += section(l.next, `${next}\n\n${escape(state.action.reason)}\n\n` +
    `${l.resume}:\n\n\`\`\`text\n${state.action.resume}\n\`\`\`\n`);
  return output;
}

export function writeInvestigationReport({ projectRoot, sourceRoot, record, state, validationIssues = [] }) {
  const path = `openspec/investigations/${record.id}.report.md`;
  let target, temporary, owned = false;
  try {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(record.id)) throw new Error("unsafe report id");
    let current = projectRoot;
    for (const part of path.split("/")) {
      current = join(current, part);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) throw new Error(`report path is a symlink: ${current}`);
    }
    target = join(projectRoot, path);
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat) {
      owned = stat.isFile() && readFileSync(target, "utf8").startsWith(MARKER);
      if (!owned) throw new Error("report path is user-owned; preserve it and choose a different investigation id");
    }
    mkdirSync(dirname(target), { recursive: true });
    temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, renderInvestigationReport({ record, state, projectRoot, sourceRoot, path, validationIssues }),
      { encoding: "utf8", flag: "wx" });
    renameSync(temporary, target);
    return { status: "current", path, stateDigest: state.stateDigest };
  } catch (error) {
    if (temporary) try { rmSync(temporary, { force: true }); } catch { /* report remains unavailable */ }
    if (owned) try { rmSync(target); } catch { /* never advertise the old report as current */ }
    return { status: "unavailable", path: null, intendedPath: path,
      reason: error.message, resume: state.action.resume };
  }
}
