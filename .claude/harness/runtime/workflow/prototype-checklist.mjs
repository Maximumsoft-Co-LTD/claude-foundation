import { WORK_TYPES } from "../contracts/work-types.mjs";

// What the approval page must show for a change, inferred only from its work
// types and the typed fields its draft already has. The harness never builds
// the page or a prototype; it names the surfaces, says which are declared as
// covered by the prototype example, and says which are still missing. Every
// work type in the catalog owes at least the shared before/after surface, and
// a test fails when a new type is added without a row (see the unit test).
//
// A `covers` declaration is the agent's own claim, not proof: Prove and Land
// never read it.

// key -> { th, en, fields }. `fields` are the draft fields that source the
// surface; a surface whose fields are all absent is reported as not specified
// by the draft, never invented.
const SURFACES = Object.freeze({
  flow: { th: "เส้นทางผู้ใช้เดินได้ รวมทางที่พลาด", en: "A user path that can be walked, including the failing path", fields: ["userFlow"] },
  states: { th: "ทุกสถานะของทุกหน้าจอ: loading, empty, error, success", en: "Every state of every screen: loading, empty, error, success", fields: ["uiStates"] },
  release: { th: "ผู้ใช้เวอร์ชันเก่าและใหม่เห็นอะไร และลำดับปล่อย", en: "What old and new versions see, and the release order", fields: ["releasePlan"] },
  experiment: { th: "กลุ่มทดลองแต่ละกลุ่มเห็นอะไร ตัวชี้วัด และเกณฑ์หยุด", en: "What each group sees, the metrics, and the stop criteria", fields: ["experimentDesign"] },
  api: { th: "แผง API: request, response และ error ทุกกรณี", en: "API panel: request, response, and every error case", fields: ["apiContracts"] },
  lib: { th: "exports, ลายเซ็น, semver และตัวอย่างเรียกใช้ก่อน-หลัง", en: "Exports, signatures, semver, and before/after usage", fields: ["libraryContract"] },
  dep: { th: "ใครใช้อยู่ ไทม์ไลน์ และเส้นทางย้าย", en: "Who uses it, the timeline, and the migration path", fields: ["deprecationPlan"] },
  schema: { th: "schema ก่อน-หลัง พร้อม migration และ rollback", en: "Schema before and after, with migration and rollback", fields: ["dataModel"] },
  rollout: { th: "ลำดับปล่อย parity และช่วง rollback", en: "Release order, parity, and the rollback window", fields: ["migrationPlan", "rollout"] },
  datafix: { th: "แถวที่โดน ก่อน-หลัง จำนวน และวิธีย้อน", en: "Affected rows before and after, the count, and the undo", fields: ["dataFix"] },
  events: { th: "สถานะของ job, retry, timeout และ idempotency", en: "Job states, retry, timeout, and idempotency", fields: ["jobContract"] },
  integ: { th: "ลำดับเรียกระบบนอก และตอบช้าหรือล้มแบบไหน", en: "The call order to the outside system, and how slow or failing replies behave", fields: ["integrations"] },
  infra: { th: "โครงสร้างก่อน-หลัง ขนาด ค่าใช้จ่าย และ rollback", en: "Topology before and after, size, cost, and rollback", fields: ["infraPlan"] },
  obs: { th: "สัญญาณที่เพิ่ม (log, metric, alert) และสิ่งที่เห็นตอนพัง", en: "The signals added (log, metric, alert) and what is seen when it breaks", fields: ["observability"] },
  perf: { th: "ตัวเลขก่อน-หลัง เป้า และวิธีวัด", en: "Numbers before and after, the target, and how it was measured", fields: ["performanceAnalysis", "nfr"] },
  pipe: { th: "pipeline ก่อน-หลัง ขั้นที่เปลี่ยน และผลเมื่อล้ม", en: "Pipeline before and after, the changed stage, and what happens when it fails", fields: ["pipelinePlan"] },
  pkg: { th: "เวอร์ชันเก่า → ใหม่ สิ่งที่ต้องคงเดิม และผลตรวจ supply-chain", en: "Old to new versions, what must stay the same, and the supply-chain checks", fields: ["dependencyChange"] },
  cfg: { th: "ค่าเก่า → ใหม่ ผลต่อพฤติกรรม และวิธีย้อน", en: "Old to new values, the effect on behavior, and the undo", fields: ["configContract"] },
  inv: { th: "โครงสร้างก่อน-หลัง และสิ่งที่ต้องคงเดิม", en: "Structure before and after, and what must stay the same", fields: ["refactor", "componentMap"] },
  repro: { th: "ก่อนแก้ ↔ หลังแก้ ที่ขอบ ไม่ใช่แค่จุดที่แจ้ง", en: "Before and after the fix at the boundaries, not only the reported case", fields: ["bugfix"] },
  priv: { th: "ข้อมูลของใคร เก็บนานแค่ไหน และใครเห็น", en: "Whose data, how long it is kept, and who sees it", fields: ["privacyAssessment"] },
  ml: { th: "ตัวอย่าง input → output ที่ดีและไม่ดี เกณฑ์ และก่อน-หลัง", en: "Good and bad input to output examples, the bar, and before and after", fields: ["modelCard"] },
  sec: { th: "ใครทำอะไรได้หรือไม่ได้ ก่อน-หลัง และกรณีโจมตีที่ถูกกัน", en: "Who can and cannot do what, before and after, and the attacks it stops", fields: ["threatModel", "hardening"] },
  cov: { th: "test ใหม่ตรวจอะไร และพังได้จริงไหม", en: "What the new tests check, and whether they can really fail", fields: ["tasks"] },
  ba: { th: "ก่อน ↔ หลัง ของสิ่งที่เปลี่ยน", en: "Before and after of what changes", fields: ["scratch.asIs", "scratch.toBe"], all: true },
  fail: { th: "กรณีพลาดพร้อม recovery", en: "Failure cases with recovery", fields: ["requirements"], failure: true }
});

// Fixed order on the page and in the data: the work-specific surface first,
// the shared before/after and failure surfaces last.
export const SURFACE_ORDER = Object.freeze([
  "flow", "states", "release", "experiment", "api", "lib", "dep", "schema", "rollout", "datafix",
  "events", "integ", "infra", "obs", "perf", "pipe", "pkg", "cfg", "inv", "repro", "priv", "ml", "sec", "cov",
  "ba", "fail"
]);
export const SURFACE_KEYS = Object.freeze([...SURFACE_ORDER]);

// Every work type in the catalog has a row; the shared before/after surface is
// in each of them, so no type can end up with an empty list.
export const TYPE_SURFACES = Object.freeze({
  feature: ["flow", "ba", "fail"],
  ui: ["flow", "states", "ba", "fail"],
  "client-release": ["release", "ba", "fail"],
  experiment: ["experiment", "ba", "fail"],
  bugfix: ["repro", "ba", "fail"],
  refactor: ["inv", "ba"],
  dependency: ["pkg", "ba"],
  config: ["cfg", "ba"],
  docs: ["ba"],
  test: ["cov", "ba"],
  chore: ["ba"],
  api: ["api", "flow", "ba", "fail"],
  library: ["lib", "ba"],
  deprecation: ["dep", "ba", "fail"],
  data: ["schema", "ba", "fail"],
  migration: ["schema", "rollout", "ba", "fail"],
  "data-fix": ["datafix", "ba", "fail"],
  async: ["events", "flow", "ba", "fail"],
  integration: ["integ", "ba", "fail"],
  infra: ["infra", "ba", "fail"],
  observability: ["obs", "ba", "fail"],
  performance: ["perf", "ba", "fail"],
  cicd: ["pipe", "ba", "fail"],
  privacy: ["priv", "ba", "fail"],
  ml: ["ml", "ba", "fail"],
  security: ["sec", "ba", "fail"]
});

// The work types the draft declares, limited to the catalog. Inference from
// paths is the caller's choice: it passes `workTypes` when it has one.
export function declaredWorkTypes(draft) {
  const raw = Array.isArray(draft?.workType) ? draft.workType : draft?.workType ? [draft.workType] : [];
  return [...new Set(raw.map((value) => String(value).trim().toLowerCase()).filter((value) => WORK_TYPES.includes(value)))];
}

const hasValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};
const at = (draft, path) => path.split(".").reduce((node, part) => node?.[part], draft);

function surfacePresent(draft, surface) {
  if (surface.failure) {
    return (Array.isArray(draft?.requirements) ? draft.requirements : [])
      .some((row) => (Array.isArray(row?.scenarios) ? row.scenarios : []).some((scenario) => scenario?.kind === "failure"));
  }
  const found = surface.fields.map((path) => hasValue(at(draft, path)));
  return surface.all ? found.every(Boolean) : found.some(Boolean);
}

// The surfaces this change owes, in the fixed order, each with its label in
// both languages, the draft fields that source it, and whether the draft
// specifies them. `present: false` means the draft does not say; the page
// writes "unknown" there and never invents an endpoint, table, or number.
export function checklistFor(draft, { workTypes } = {}) {
  const types = workTypes && workTypes.length ? workTypes : declaredWorkTypes(draft);
  const wanted = new Set(types.flatMap((type) => TYPE_SURFACES[type] || []));
  if (!wanted.size) wanted.add("ba");
  return SURFACE_ORDER.filter((key) => wanted.has(key)).map((key) => {
    const surface = SURFACES[key];
    return {
      key,
      label: { th: surface.th, en: surface.en },
      source: surface.fields.join(" · "),
      present: surfacePresent(draft, surface)
    };
  });
}

// The prototype example a draft names, if any. `path` stays relative to
// `.foundation/previews/<change>/`.
export function prototypeExample(draft) {
  const row = (Array.isArray(draft?.examples) ? draft.examples : [])
    .find((example) => example && typeof example === "object" && example.type === "prototype");
  return row || null;
}

// Per-item status against the prototype's own declaration:
//   none     there is no prototype example
//   unknown  the example declares no `covers`
//   covered  the example lists the key
//   missing  the example declares `covers` without the key
export function coverageReport(draft, { workTypes } = {}) {
  const items = checklistFor(draft, { workTypes });
  const example = prototypeExample(draft);
  const declared = example && Array.isArray(example.covers) ? new Set(example.covers.map(String)) : null;
  const statused = items.map((item) => ({
    ...item,
    status: !example ? "none" : !declared ? "unknown" : declared.has(item.key) ? "covered" : "missing"
  }));
  const covered = statused.filter((item) => item.status === "covered").length;
  const state = !example ? "none" : !declared ? "unknown" : covered === statused.length ? "complete" : "incomplete";
  return {
    state,
    covered,
    total: statused.length,
    prototype: example ? { path: String(example.path || ""), declaresCovers: Boolean(declared) } : null,
    items: statused,
    // The agent's claim, never evidence: Prove and Land do not read it.
    advisory: true
  };
}

// Intake issues for a `covers` declaration. Unknown keys name their path so
// one batched EDIT fixes them. With declared work types a key must be one of
// this change's surfaces; without them any catalog key is accepted.
export function coversIssues(draft) {
  const issues = [];
  const types = declaredWorkTypes(draft);
  const allowed = types.length ? new Set(checklistFor(draft, { workTypes: types }).map((item) => item.key)) : new Set(SURFACE_KEYS);
  (Array.isArray(draft?.examples) ? draft.examples : []).forEach((example, index) => {
    if (!example || typeof example !== "object" || example.type !== "prototype" || example.covers === undefined) return;
    const at = `examples[${index}].covers`;
    if (!Array.isArray(example.covers)) {
      issues.push(`semantic draft ${at} must be an array of surface keys from: ${[...allowed].join(", ")}`);
      return;
    }
    example.covers.forEach((key, position) => {
      if (typeof key !== "string" || !allowed.has(key))
        issues.push(`semantic draft ${at}[${position}] ${JSON.stringify(key)} is not a surface this change shows; use one of: ${[...allowed].join(", ")}`);
    });
  });
  return issues;
}

// One advisory line for `change start`: what the page still owes, or nothing.
// Never a repair and never a gate. A change whose only surface is before/after
// (docs, chore) owes nothing more and prints nothing.
export function checklistNoteLine(draft, { workTypes } = {}) {
  const report = coverageReport(draft, { workTypes });
  if (report.total <= 1 && report.state === "none") return "";
  const names = (items) => items.map((item) => item.key).join(", ");
  if (report.state === "none") return `prototype (advisory, approval page): no prototype yet; it should show ${names(report.items)}; the prototype skill builds it`;
  if (report.state === "unknown") return `prototype (advisory, approval page): the prototype declares no 'covers'; it should show ${names(report.items)}`;
  const missing = report.items.filter((item) => item.status === "missing");
  return missing.length ? `prototype (advisory, approval page): the prototype does not yet cover ${names(missing)}` : "";
}
