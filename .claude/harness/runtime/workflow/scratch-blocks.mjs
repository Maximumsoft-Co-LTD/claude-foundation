// Static HTML for the approval page's scratch: page text in Thai or English
// and one renderer per typed example. Every draft value passes through esc();
// nothing here emits a script, an event handler, or a URL from the draft
// except prototype and artifact links the caller has already confined.

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TEXT = {
  en: {
    get: "What you get", change: "What changes", ifFail: "If it fails", before: "Before", after: "After",
    noSummary: "No plain-language summary yet; the agent can add 'scratch' to the draft.",
    examples: "Examples", agreed: "Agreed", actual: "After Build",
    proof: "proof", fail: "failed", preview: "preview", stale: "preview (stale)", none: "no result yet",
    noResult: "No result yet.", willCompare: "After Build this compares:", openArtifact: "Open the artifact",
    success: "success", boundary: "boundary", failure: "failure", given: "Given", when: "When", then: "Then",
    rule: "Rule", request: "Request", response: "Response", rollback: "Rollback", phases: "Release order",
    downtime: "Downtime", now: "now", target: "target", noNumber: "no number yet", chosen: "chosen",
    reversible: "Reversible", stop: "Stop if", kill: "Emergency off", yes: "allowed", no: "denied",
    good: "Good output", bad: "Fails if", rubric: "Rubric", code: "Code", missingPrototype: "The prototype file is not there yet.",
    openFull: "Open full screen", roles: "By approver role", domains: "Technical domains", diagrams: "Diagrams",
    noDiagrams: "This change declares no diagrams.", summary: "Summary", suggestions: "Suggested previews",
    risk: "Risk level", intent: "intent", revision: "contract revision", readOnly:
      "Read-only projection. Only labels marked proof come from a valid passing receipt; previews and design statements are not proof.",
    legacy: "This change has no typed draft for its current revision, so the package shows packet information only and its detail is limited.",
    diagramText: "Shown as Mermaid text when the local renderer is unavailable.",
    system: "System does", user: "User sees", stage: "Stage", who: "Who / share", whenCol: "When",
    noEvidence: "no evidence yet", artifactCol: "Artifact", domainsCol: "Domains", evidenceCol: "Evidence",
    allChanges: "all changes", noRole: "No approval needed from this role for this change.", noDomain: "No specific domain.",
    packet: "Packet:", suggestionsNote: "Optional. A suggestion never blocks approval or Build.",
    capabilityWord: "capability", noProvider: "no provider yet; declare a provider with capability",
    noProviderTail: "in evidence.yaml", externalRef: "external: needs a decision-ref",
    undeclared: "Not declared in the agreement.", noFailure: "No failure scenario in the agreement concerns this.",
    previewWord: "Preview", previewOnly: "(preview only; never proof)", openPreview: "Open the preview artifact",
    head: {}, artifactNames: {}
  },
  th: {
    get: "จะได้อะไร", change: "ของเดิมเปลี่ยนอะไร", ifFail: "ถ้าพลาดเป็นยังไง", before: "ก่อน", after: "หลัง",
    noSummary: "ยังไม่ได้เขียนสรุปภาษาคน agent เติม scratch ใน draft ได้",
    examples: "ตัวอย่าง", agreed: "ตกลงไว้", actual: "ผลจริงหลัง Build",
    proof: "proof", fail: "ไม่ผ่าน", preview: "preview", stale: "preview เก่า", none: "ยังไม่มีผล",
    noResult: "ยังไม่มีผล", willCompare: "หลัง Build จะเทียบ:", openArtifact: "เปิดไฟล์ผลลัพธ์",
    success: "ปกติ", boundary: "กรณีขอบ", failure: "ผิดพลาด", given: "ก่อน", when: "เมื่อ", then: "ได้",
    rule: "กฎ", request: "Request", response: "Response", rollback: "Rollback", phases: "ลำดับปล่อย",
    downtime: "Downtime", now: "ตอนนี้", target: "เป้า", noNumber: "ยังไม่มีตัวเลข", chosen: "เลือก",
    reversible: "ย้อนกลับ", stop: "หยุดถ้า", kill: "ปิดฉุกเฉิน", yes: "ได้", no: "ไม่ได้",
    good: "output ที่ดี", bad: "ไม่ผ่านถ้า", rubric: "เกณฑ์", code: "โค้ด", missingPrototype: "ยังไม่มีไฟล์ prototype",
    openFull: "เปิดเต็มจอ", roles: "ตามบทบาทผู้อนุมัติ", domains: "Technical domains", diagrams: "แผนภาพ",
    noDiagrams: "change นี้ไม่มีแผนภาพ", summary: "สรุป", suggestions: "Preview ที่แนะนำ",
    risk: "ความเสี่ยง", intent: "intent", revision: "ฉบับที่", readOnly:
      "หน้านี้อ่านอย่างเดียว เฉพาะป้าย proof ที่มาจาก receipt ที่ผ่านจริง preview และเอกสารออกแบบไม่ใช่ proof",
    legacy: "change นี้ไม่มี typed draft ของฉบับปัจจุบัน หน้านี้จึงแสดงจาก packet และรายละเอียดมีจำกัด",
    diagramText: "แสดงเป็นข้อความ Mermaid เมื่อเปิด renderer ในเครื่องไม่ได้",
    system: "ระบบทำ", user: "ผู้ใช้เห็น", stage: "ขั้น", who: "ใคร / สัดส่วน", whenCol: "เมื่อไร",
    noEvidence: "ยังไม่มีหลักฐาน", artifactCol: "Artifact", domainsCol: "Domain", evidenceCol: "หลักฐาน",
    allChanges: "ทุก change", noRole: "บทบาทนี้ไม่ต้องอนุมัติ change นี้", noDomain: "ไม่มี domain เฉพาะ",
    packet: "Packet:", suggestionsNote: "ไม่บังคับ คำแนะนำไม่บล็อกการอนุมัติหรือ Build",
    capabilityWord: "capability", noProvider: "ยังไม่มี provider ประกาศ provider ที่มี capability",
    noProviderTail: "ใน evidence.yaml", externalRef: "ภายนอก: ต้องมี decision-ref",
    undeclared: "ไม่ได้ประกาศใน agreement", noFailure: "ไม่มี failure scenario ใน agreement ที่เกี่ยวกับเรื่องนี้",
    previewWord: "Preview", previewOnly: "(preview เท่านั้น ไม่ใช่ proof)", openPreview: "เปิดไฟล์ preview",
    head: {
      Requirement: "Requirement", Scenario: "Scenario", Kind: "ชนิด", Given: "ก่อน", When: "เมื่อ", Then: "ผล",
      Task: "Task", Outcome: "ผลลัพธ์", Files: "ไฟล์", Priority: "ลำดับ", "As a": "ในฐานะ", "I want": "ต้องการ",
      "So that": "เพื่อ", "Success criteria": "เกณฑ์ผ่าน", "Non-goals": "ไม่อยู่ในขอบเขต", Auth: "สิทธิ์",
      Errors: "Error", Fields: "ฟิลด์", Access: "สิทธิ์", Screen: "หน้าจอ", States: "สถานะ", Default: "ค่าเริ่มต้น",
      Validation: "ค่าที่รับ", Reproduction: "วิธีทำซ้ำ", "Root cause": "สาเหตุ", Regression: "กันเกิดซ้ำ",
      Invariants: "สิ่งที่ต้องคงเดิม", Detail: "รายละเอียด", Decision: "การตัดสินใจ", Reason: "เหตุผล",
      Failure: "ความล้มเหลว", "User sees": "ผู้ใช้เห็น", Recovery: "แก้คืน"
    },
    artifactNames: {
      impact: "ไฟล์และงานที่จะเปลี่ยน", testmap: "ตาราง test", flow: "User story และเกณฑ์ผ่าน", ui: "สถานะหน้าจอ",
      shot: "Prototype หรือภาพหน้าจอ", nav: "การนำทางบนอุปกรณ์", a11y: "ตรวจ accessibility", api: "สัญญา API และ sequence",
      playground: "ลองเรียก API (mock)", state: "State machine", integ: "การเชื่อมระบบภายนอกและตาราง failure",
      retry: "จำลอง retry timeout และ dead-letter", perm: "ตารางสิทธิ์", concur: "ทดสอบกดซ้ำพร้อมกัน",
      ledger: "Ledger และ idempotency", timeline: "ลำดับเวลาของ job", compat: "ความเข้ากันได้ของ contract",
      erd: "ERD และ schema diff", dryrun: "ซ้อม migration และ rollback", lineage: "ที่มาของข้อมูล",
      sample: "ตัวอย่างผลลัพธ์หรือ dashboard", c4: "แผนภาพสถาปัตยกรรม", plan: "แผนเปลี่ยน topology",
      pipe: "ซ้อม deploy", alert: "ตัวอย่าง alert และ dashboard", bench: "Benchmark ก่อนและหลัง", threat: "Threat model",
      repro: "วิธีทำซ้ำและสาเหตุ", equiv: "พฤติกรรมเหมือนเดิม", evaluation: "ประเมินผล AI agent",
      config: "ค่า config และ rollout", guard: "Guardrail ของการทดลอง"
    }
  }
};

export function packageText(language) {
  return String(language || "").toLowerCase().split("-")[0] === "th" ? TEXT.th : TEXT.en;
}

const list = (value) => Array.isArray(value) ? value : [];
const cell = (value) => value === undefined || value === null ? ""
  : typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
const table = (cols, rows, mark = () => "") => `<div class="scroll"><table><thead><tr>${
  cols.map((col) => `<th scope="col">${esc(cell(col))}</th>`).join("")}</tr></thead><tbody>${
  rows.map((row, i) => `<tr>${list(row).map((value, j) => `<td class="${mark(i, j)}">${esc(cell(value))}</td>`).join("")}</tr>`).join("")
}</tbody></table></div>`;
const box = (label, value) => `<div class="box"><p class="box-h">${esc(label)}</p><pre>${esc(cell(value))}</pre></div>`;
const OP = { "+": "add", "~": "chg", "-": "del", "-/+": "del" };

function scenarioCard(row, t) {
  const kind = ["success", "boundary", "failure"].includes(row.kind) ? row.kind : "success";
  return `<div class="ex k-${kind}"><p class="ex-h"><b>${esc(row.name)}</b><span>${esc(t[kind])}</span></p>` +
    (row.given ? `<p><span class="l">${esc(t.given)}</span>${esc(row.given)}</p>` : "") +
    `<p><span class="l">${esc(t.when)}</span>${esc(row.when)}</p><p><span class="l">${esc(t.then)}</span><b>${esc(row.then)}</b></p></div>`;
}
function timelineList(events) {
  return `<ol class="tl">${list(events).map((row) => `<li class="${row.kind === "failure" ? "k-failure" : row.kind === "ok" ? "k-success" : ""}">` +
    `<span class="tl-t">${esc(row.t)}</span><span class="tl-d" aria-hidden="true"></span><div>${esc(row.event)}` +
    `${row.state ? ` <span class="st">${esc(row.state)}</span>` : ""}${row.note ? `<p class="muted">${esc(row.note)}</p>` : ""}</div></li>`).join("")}</ol>`;
}

const RENDER = {
  prototype: (b, t, ctx) => {
    const href = ctx.prototypeHref(b.path);
    if (!href) return `<p class="muted">${esc(t.missingPrototype)} <code>${esc(b.path)}</code></p>`;
    return `<iframe class="frame" title="${esc(b.title)}" sandbox="allow-scripts allow-forms" src="${esc(href)}"></iframe>` +
      `<p class="small"><a href="${esc(href)}">${esc(t.openFull)}</a>${b.note ? ` · ${esc(b.note)}` : ""}</p>`;
  },
  examples: (b, t) => list(b.rules).map((rule) => `<p class="rule">${esc(t.rule)}: ${esc(rule.rule)}</p>` +
    `<div class="cards">${list(rule.rows).map((row) => scenarioCard(row, t)).join("")}</div>`).join(""),
  api: (b, t) => list(b.endpoints).map((endpoint) => `<div class="ep"><p><span class="method">${esc(endpoint.method)}</span> ` +
    `<code>${esc(endpoint.path)}</code>${endpoint.auth ? ` <span class="chip">${esc(endpoint.auth)}</span>` : ""}</p>` +
    (endpoint.summary ? `<p class="muted">${esc(endpoint.summary)}</p>` : "") +
    list(endpoint.cases).map((row, i) => `<details class="case"${i ? "" : " open"}><summary><span class="status s${esc(String(row.status)[0])}">${esc(row.status)}</span> ${esc(row.label || "")}</summary>` +
      `<div class="grid2">${box(t.request, row.request)}${box(t.response, row.response)}</div></details>`).join("") + `</div>`).join(""),
  timeline: (b) => timelineList(b.events),
  dataDiff: (b, t) => {
    const added = list(b.after?.cols).filter((col) => !list(b.before?.cols).includes(col));
    const mark = (cols) => (i, j) => added.includes(cols[j]) ? "add" : "";
    return `<p class="small"><b>${esc(b.table)}</b></p><div class="grid2"><div><p class="small muted">${esc(t.before)}</p>${table(list(b.before?.cols), list(b.before?.rows))}</div>` +
      `<div><p class="small muted">${esc(t.after)}</p>${table(list(b.after?.cols), list(b.after?.rows), mark(list(b.after?.cols)))}</div></div>` +
      (list(b.phases).length ? `<p class="small"><b>${esc(t.phases)}</b></p><ol class="small">${list(b.phases).map((row) => `<li>${esc(row)}</li>`).join("")}</ol>` : "") +
      (b.rollback ? `<p class="small"><b>${esc(t.rollback)}:</b> <code>${esc(b.rollback)}</code></p>` : "") + (b.risk ? `<p class="small muted">${esc(b.risk)}</p>` : "");
  },
  lineage: (b) => `<div class="lin">${list(b.steps).map((row, i) => (i ? `<p class="arrow">↓ ${esc(row.how || "")}</p>` : "") +
    `<div class="stp"><b>${esc(row.name)}</b><pre>${esc(cell(row.sample))}</pre></div>`).join("")}</div>`,
  mermaid: (b, t) => `<pre class="mermaid">${esc(b.source)}</pre><p class="small muted">${esc(t.diagramText)}</p>`,
  failures: (b, t) => table([t.ifFail, t.system, t.user], list(b.rows).map((row) => [row.failure, row.system, row.user])),
  permission: (b, t) => `<div class="scroll"><table><thead><tr><th scope="col"></th>${list(b.roles).map((role) => `<th scope="col">${esc(role)}</th>`).join("")}</tr></thead><tbody>${
    list(b.actions).map((row) => `<tr><th scope="row">${esc(row.action)}</th>${list(b.roles).map((role) => list(row.allow).includes(role)
      ? `<td class="yes">✓ ${esc(t.yes)}</td>` : `<td class="no">✕ ${esc(t.no)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` +
    (b.note ? `<p class="small muted">${esc(b.note)}</p>` : ""),
  plan: (b, t) => (b.summary ? `<p class="small"><b>${esc(b.summary)}</b></p>` : "") +
    `<ul class="plan">${list(b.items).map((row) => `<li class="${OP[row.op] || ""}">${esc(row.op)} ${esc(row.resource)}${row.detail ? `  # ${esc(row.detail)}` : ""}</li>`).join("")}</ul>` +
    (b.downtime ? `<p class="small"><b>${esc(t.downtime)}:</b> ${esc(b.downtime)}</p>` : "") + (b.rollback ? `<p class="small"><b>${esc(t.rollback)}:</b> ${esc(b.rollback)}</p>` : ""),
  snapshot: (b, t) => `<div class="cards">${list(b.cases).map((row) => `<div class="ex"><p class="ex-h"><b>${esc(row.input)}</b></p>` +
    `<div class="grid2">${box(t.before, row.before)}${box(t.after, row.after)}</div></div>`).join("")}</div>`,
  repro: (b, t) => (b.env ? `<p class="small">${esc(b.env)}</p>` : "") + `<ol>${list(b.steps).map((row) => `<li>${esc(row)}</li>`).join("")}</ol>` +
    `<div class="grid2"><div class="ex k-failure"><p class="ex-h"><b>${esc(t.now)}</b></p><p>${esc(b.actual)}</p></div>` +
    `<div class="ex k-success"><p class="ex-h"><b>${esc(t.after)}</b></p><p>${esc(b.expected)}</p></div></div>` + (b.cause ? `<p class="small">${esc(b.cause)}</p>` : ""),
  perf: (b, t) => {
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    const max = Math.max(1, ...list(b.metrics).flatMap((m) => [m.now, m.target].filter(num))) * 1.15;
    const bar = (label, value, unit, cls) => `<div class="bar-row"><span>${esc(label)}</span>${num(value)
      ? `<span class="track"><span class="fill ${cls}" style="width:${(value / max * 100).toFixed(1)}%"></span></span><span>${esc(value)} ${esc(unit)}</span>`
      : `<span class="warn">${esc(t.noNumber)}</span><span></span>`}</div>`;
    return (b.load ? `<p class="small muted">${esc(b.load)}</p>` : "") + `<div class="bars">${list(b.metrics).map((m) =>
      bar(`${m.name} ${t.now}`, m.now, m.unit, "now") + bar(`${m.name} ${t.target}`, m.target, m.unit, "target")).join("")}</div>`;
  },
  golden: (b, t) => (b.rubric ? `<p class="small"><b>${esc(t.rubric)}:</b> ${esc(b.rubric)}</p>` : "") + `<div class="cards">${list(b.cases).map((row) =>
    `<div class="ex k-${["boundary", "failure"].includes(row.kind) ? row.kind : "success"}"><p class="ex-h"><b>${esc(row.name)}</b><span>${esc(row.tag || "")}</span></p>` +
    `${box("input", row.input)}${box(t.good, row.good)}${row.bad ? `<p class="small no">${esc(t.bad)}: ${esc(row.bad)}</p>` : ""}</div>`).join("")}</div>`,
  adr: (b, t) => `<p><b>${esc(b.question)}</b></p><div class="cards">${list(b.options).map((row) => `<div class="opt${row.chosen ? " chosen" : ""}">` +
    `<p class="ex-h"><b>${esc(row.name)}</b>${row.chosen ? `<span class="yes">${esc(t.chosen)}</span>` : ""}</p>` +
    (row.pros ? `<p class="small"><span class="yes">+</span> ${esc(row.pros)}</p>` : "") + (row.cons ? `<p class="small"><span class="no">−</span> ${esc(row.cons)}</p>` : "") + `</div>`).join("")}</div>` +
    (b.reversible ? `<p class="small"><b>${esc(t.reversible)}:</b> ${esc(b.reversible)}</p>` : ""),
  rollout: (b, t) => table([t.stage, t.who, t.whenCol, t.stop], list(b.stages).map((row) => [row.stage, row.who, row.when, row.stop])) +
    (b.kill ? `<p class="small"><b>${esc(t.kill)}:</b> ${esc(b.kill)}</p>` : ""),
  apiDiff: (b, t) => `<ul class="plan">${list(b.changes).map((row) => `<li class="${OP[row.op] || ""}">${esc(row.op)} ${esc(row.signature)}${row.note ? `  // ${esc(row.note)}` : ""}</li>`).join("")}</ul>` +
    (b.before || b.after ? `<div class="grid2">${box(t.before, b.before)}${box(t.after, b.after)}</div>` : ""),
  strings: (b) => table(["key", ...list(b.locales)], list(b.rows).map((row) => [row.key, ...list(b.locales).map((locale) => row[locale])])) +
    (b.note ? `<p class="small muted">${esc(b.note)}</p>` : ""),
  alert: (b) => box("rule", b.rule) + `<div class="push"><b>${esc(b.title)}</b><p class="small">${esc(b.message || "")}</p></div>` +
    (list(b.dashboard).length ? `<div class="kpis">${list(b.dashboard).map((row) => `<div class="kpi"><b>${esc(row.value)}</b><span>${esc(row.label)}</span></div>`).join("")}</div>` : ""),
  privacy: (b) => table(["field", "pii", "where", "retention"], list(b.fields).map((row) => [row.field, row.pii, row.where, row.retention])) +
    (list(b.threats).length ? table(["threat", "mitigation"], list(b.threats).map((row) => [row.threat, row.mitigation])) : ""),
  coverage: (b) => table(["scenario", "test", "level"], list(b.rows).map((row) => [row.scenario, row.test, row.level]),
    (i, j) => j === 1 && /^[—-]?$/.test(String(list(b.rows)[i]?.test || "").trim()) ? "del" : ""),
  consumers: (b) => table(["consumer", "usage", "action"], list(b.rows).map((row) => [row.consumer, row.usage, row.action])) +
    (list(b.timeline).length ? timelineList(b.timeline) : ""),
  messages: (b) => list(b.items).map((row) => (row.when ? `<p class="small muted">${esc(row.when)}</p>` : "") + `<div class="msg">` +
    (row.from ? `<p class="small muted">${esc(row.from)}</p>` : "") + `<p><b>${esc(row.subject)}</b></p>` +
    String(row.body ?? "").split("\n").map((line) => `<p>${esc(line)}</p>`).join("") + (row.cta ? `<p><span class="cta">${esc(row.cta)}</span></p>` : "") + `</div>`).join(""),
  terminal: (b) => `<pre class="term">${list(b.lines).map((line) => {
    const value = String(line);
    if (value.startsWith("$ ")) return `<span class="t-p">${esc(value)}</span>`;
    if (value.startsWith("! ")) return `<span class="t-e">${esc(value.slice(2))}</span>`;
    if (value.startsWith("+ ")) return `<span class="t-o">${esc(value.slice(2))}</span>`;
    return esc(value);
  }).join("\n")}</pre>`,
  doc: (b, t) => `<div class="doc">${list(b.sections).map((row) => typeof row === "string" ? `<p>${esc(row)}</p>`
    : (row.heading ? `<h4>${esc(row.heading)}</h4>` : "") + (row.text ? `<p>${esc(row.text)}</p>` : "") +
      (row.code ? `<pre>${esc(row.code)}</pre>` : "") + (row.expect ? `<p class="small muted">${esc(row.expect)}</p>` : "")).join("")}</div>`,
  pipeline: (b) => `<p class="pipe">${list(b.before).map((row) => `<span>${esc(row)}</span>`).join(" → ")}</p>` +
    `<p class="pipe">${list(b.after).map((row) => `<span class="${list(b.before).includes(row) ? "" : "add"}">${esc(row)}</span>`).join(" → ")}</p>` +
    (b.note ? `<p class="small">${esc(b.note)}</p>` : ""),
  search: (b) => list(b.queries).map((row) => `<div class="ex"><p class="ex-h"><b>“${esc(row.q)}”</b><span>${esc(row.tag || "")}</span></p>` +
    `<ol class="small">${list(row.results).map((value) => `<li>${esc(cell(value))}</li>`).join("")}</ol>${row.note ? `<p class="small muted">${esc(row.note)}</p>` : ""}</div>`).join(""),
  report: (b) => `<div class="kpis">${list(b.kpis).map((row) => `<div class="kpi"><b>${esc(row.value)}</b><span>${esc(row.label)}</span>` +
    `${row.delta ? ` <span class="${String(row.delta).startsWith("-") ? "no" : "yes"}">${esc(row.delta)}</span>` : ""}</div>`).join("")}</div>` +
    table(list(b.table?.cols), list(b.table?.rows)) + (b.defs ? `<p class="small">${esc(b.defs)}</p>` : ""),
  diffSummary: (b) => `<ul class="plan">${list(b.items).map((row) => `<li class="${OP[row.op] || ""}">${esc(row.op)} ${esc(row.path)}${row.note ? `  ${esc(row.note)}` : ""}</li>`).join("")}</ul>`
};

export const RENDERED_TYPES = Object.freeze(Object.keys(RENDER));

// The agreed view of one example. Unknown types render nothing; the draft
// validator already refuses them, so this only guards older states.
export function renderExample(example, t, ctx = {}) {
  const render = RENDER[example?.type];
  if (!render) return "";
  return render(example, t, { prototypeHref: () => null, ...ctx });
}
