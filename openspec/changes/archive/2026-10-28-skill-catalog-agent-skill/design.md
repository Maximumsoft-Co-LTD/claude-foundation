# Design

## Work type

docs, test

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** description ของ testing/database/api-design/security/debug-fundamentals ยังคงคำ workType, riskSignals, requirement หรือ scenario และคำว่า Skip
  - **Why:** spec build-skill-routing (spec-vocabulary-descriptions) และ skill-routing.test.mjs กำหนดไว้แล้ว การย่อจึงต้องรักษาสัญญานี้
  - **Rejected:** none
  - **Consequences:** description ของ 5 ตัวนี้ยาวกว่าตัวอื่นเล็กน้อยแต่ยัง ≤ 40 คำ
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** เนื้อหา reference ที่ spec skill-guidance และ test pin ไว้คงอยู่ ตัดได้เฉพาะส่วนที่ไม่ได้ pin
  - **Why:** ผู้ใช้ตัดสินว่า guardrail ทุกตัวต้องคงความหมาย และ spec เดิมยังมีผล
  - **Rejected:** none
  - **Consequences:** ไฟล์ที่ pin (เช่น shared-state-and-async.md, pstack-adoption.md, schemas.md) ลดได้น้อย ทำให้ยอดรวมลดได้ราว 40% ไม่ใช่ครึ่ง
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** เป้าหมาย references รวม ≤ 8,500 บรรทัด ตามผลรวมของแผนรายไฟล์ใน requirement pruned-references
  - **Why:** คำนวณจากแผน keep/merge/drop รายไฟล์ ไม่ใช่ตัวเลขกลม ๆ
  - **Rejected:** none
  - **Consequences:** ถ้า Build ลดได้ไม่ถึงต้อง amend พร้อมเหตุผลรายไฟล์ ไม่ตัดเนื้อหาที่ pin เพื่อให้ถึงตัวเลข
- **Decision ID:** DEC-004
  - **Status:** accepted
  - **Decision:** ผล skill-evaluation เขียนเป็นรายงานลงวันที่ใน docs/reports/ ส่วน transcript ดิบอยู่นอก Git
  - **Why:** procedure.md ห้ามเก็บผล evaluation ใน managed skills และ CLAUDE.md ให้เก็บ raw evidence นอก Git
  - **Rejected:** none
  - **Consequences:** ผลซ้ำได้จากรายงาน แต่ transcript ต้องขอจากเครื่องที่รัน
- **Decision ID:** DEC-005
  - **Status:** accepted
  - **Decision:** SKILL.md ทุกตัวในขอบเขตใช้โครงเดียวกัน: ชื่อ + ประโยคจุดยืน 1 บรรทัด, ## Steps (≤ 6 ข้อ), ## Harness (≤ 3 บรรทัด), ## References (read only when needed) เป็น bullet ไฟล์—เมื่อไรอ่าน
  - **Why:** agent เจอรูปแบบเดียวกันทุกครั้ง อ่านเร็วและรู้ว่าต้องเปิด reference ไหนโดยไม่ต้องอ่านทั้งหมด
  - **Rejected:** none
  - **Consequences:** ส่วน Check before finishing เดิมถูกรวมเข้า Steps หรือตัด ถ้า test pin ประโยคใน checklist ต้องย้ายประโยคนั้นมาที่ Steps

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| description ยาวเกิน | skill-catalog.test.mjs fail ระบุชื่อ skill | ย่อ description นั้นแล้วรัน test ซ้ำ | trigger-descriptions |
| ลบไฟล์ที่ยังถูกอ้าง | reference-governance.mjs รายงาน unresolved reference | คืนไฟล์หรือแก้ลิงก์แล้วรันซ้ำ | pruned-references |
| run ไม่สำเร็จ | รายงานระบุ case นั้นเป็น not-run ไม่ใช่ pass | รันซ้ำเฉพาะ case ที่ not-run | trigger-evaluation-report |
| catalog ใหม่แย่ลง | รายงานติดป้าย regression และ Prove ไม่ผ่าน | แก้ description ที่เกี่ยวแล้วรัน candidate arm ใหม่ | trigger-evaluation-report |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001; T007 | `docs/reports/2026-10-27-skill-catalog-trigger-evaluation.md` (add), `docs/reports/README.md` |
| T002; T003 | `.claude/skills/*/SKILL.md`, `.claude/tests/harness/run-context-budget-tests.sh` |
| T002 | `.claude/rules/fundamentals.md`, `.claude/harness/tests/skill-routing.test.mjs` |
| T002; T003; T004; T005; T006 | `.claude/tests/docs/skill-catalog.test.mjs` |
| T003; T006 | `.claude/tests/docs/run-doc-consistency.sh` |
| T004 | `.claude/skills/debug-fundamentals/`, `.claude/skills/performance-investigation/`, `.claude/skills/change-impact-analysis/`, `.claude/skills/refactoring-fundamentals/`, `.claude/skills/testing-fundamentals/`, `.claude/skills/coding-discipline/` |
| T005 | `.claude/skills/ddd-strategic/`, `.claude/skills/architecture-fundamentals/`, `.claude/skills/programming-fundamentals/`, `.claude/skills/concurrency-fundamentals/`, `.claude/skills/database-fundamentals/`, `.claude/skills/hexagonal-backend/`, `.claude/skills/api-design-fundamentals/`, `.claude/skills/queue-fundamentals/`, `.claude/skills/security-fundamentals/`, `.claude/skills/observability-fundamentals/` |
| T006 | `.claude/skills/frontend-design/`, `.claude/skills/tailwind-design-system/`, `.claude/skills/ux-ui-principles/`, `.claude/skills/ui-ux-pro-max/`, `.claude/skills/git-workflow/`, `.claude/skills/delivery-engineering/`, `.claude/skills/claude-md/`, `.claude/skills/init-project-docs/`, `.claude/skills/harness-html-report/`, `.claude/skills/grill-task-gu/`, `.claude/skills/grill-task-gu-please/`, `.claude/skills/skill-creator/`, `.claude/skills/skill-evaluation/`, `.claude/skills/skill-suite-auditor/` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   └── tests/
│   │       └── ~ skill-routing.test.mjs
│   ├── rules/
│   │   └── ~ fundamentals.md
│   ├── skills/
│   │   ├── */
│   │   │   └── ~ SKILL.md
│   │   ├── ~ api-design-fundamentals/
│   │   ├── ~ architecture-fundamentals/
│   │   ├── ~ change-impact-analysis/
│   │   ├── ~ claude-md/
│   │   ├── ~ coding-discipline/
│   │   ├── ~ concurrency-fundamentals/
│   │   ├── ~ database-fundamentals/
│   │   ├── ~ ddd-strategic/
│   │   ├── ~ debug-fundamentals/
│   │   ├── ~ delivery-engineering/
│   │   ├── ~ frontend-design/
│   │   ├── ~ git-workflow/
│   │   ├── ~ grill-task-gu-please/
│   │   ├── ~ grill-task-gu/
│   │   ├── ~ harness-html-report/
│   │   ├── ~ hexagonal-backend/
│   │   ├── ~ init-project-docs/
│   │   ├── ~ observability-fundamentals/
│   │   ├── ~ performance-investigation/
│   │   ├── ~ programming-fundamentals/
│   │   ├── ~ queue-fundamentals/
│   │   ├── ~ refactoring-fundamentals/
│   │   ├── ~ security-fundamentals/
│   │   ├── ~ skill-creator/
│   │   ├── ~ skill-evaluation/
│   │   ├── ~ skill-suite-auditor/
│   │   ├── ~ tailwind-design-system/
│   │   ├── ~ testing-fundamentals/
│   │   ├── ~ ui-ux-pro-max/
│   │   └── ~ ux-ui-principles/
│   └── tests/
│       ├── docs/
│       │   ├── ~ run-doc-consistency.sh
│       │   └── ~ skill-catalog.test.mjs
│       └── harness/
│           └── ~ run-context-budget-tests.sh
└── docs/
    └── reports/
        ├── + 2026-10-27-skill-catalog-trigger-evaluation.md
        └── ~ README.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| รายงานมีสอง arm; run ไม่สำเร็จ; catalog ใหม่แย่ลง | task check | `node -e "const s=require('fs').readFileSync('docs/reports/2026-10-27-skill-catalog-trigger-evaluation.md','utf8');if(!/281caac1b/.test(s)\|\|!/## Baseline/.test(s)\|\|!/\\| *api-design-fundamentals/.test(s))process.exit(1)"` | T001 |
| description ตรงตามข้อความที่กำหนด; spec-vocabulary ยังอยู่; lifecycle skill ไม่ถูกแตะ; description ยาวเกิน; แถว router ตรงกับ description | task check | `node --test .claude/harness/tests/skill-routing.test.mjs && sh .claude/tests/harness/run-context-budget-tests.sh && node --test .claude/tests/docs/skill-catalog.test.mjs && git diff --quiet 281caac1b -- .claude/skills/change/SKILL.md .claude/skills/build/SKILL.md .claude/skills/prove/SKILL.md .claude/skills/land/SKILL.md .claude/skills/investigate/SKILL.md .claude/skills/dev/SKILL.md .claude/skills/feature/SKILL.md .claude/skills/changes/SKILL.md` | T002 |
| ทุก body อยู่ใน budget และใช้โครงเดียวกัน; guardrail ยังถูกจับ; จำนวน assertion ห้ามคำไม่ลดลง | task check | `sh .claude/tests/harness/run-context-budget-tests.sh && node --test .claude/tests/docs/skill-catalog.test.mjs && sh .claude/tests/docs/run-doc-consistency.sh` | T003 |
| ขนาดรวมลดและ governance ผ่าน; เนื้อหาที่ pin ยังครบ; ไฟล์ที่แผนบอกว่าลบหรือรวมหายไปจริง; ลบไฟล์ที่ยังถูกอ้าง | task check | `node .claude/tests/harness/reference-governance.mjs .claude/skills && node --test .claude/tests/docs/skill-catalog.test.mjs && test ! -e .claude/skills/debug-fundamentals/references/instrumentation.md && test -e .claude/skills/debug-fundamentals/references/tools.md` | T004 |
| ขนาดรวมลดและ governance ผ่าน; เนื้อหาที่ pin ยังครบ; ไฟล์ที่แผนบอกว่าลบหรือรวมหายไปจริง; ลบไฟล์ที่ยังถูกอ้าง | task check | `node .claude/tests/harness/reference-governance.mjs .claude/skills && node --test .claude/tests/docs/skill-catalog.test.mjs && test ! -e .claude/skills/architecture-fundamentals/references/observability.md && test ! -e .claude/skills/programming-fundamentals/references/testing.md && test ! -e .claude/skills/api-design-fundamentals/references/auth-and-limits.md` | T005 |
| ขนาดรวมลดและ governance ผ่าน; เนื้อหาที่ pin ยังครบ; ไฟล์ที่แผนบอกว่าลบหรือรวมหายไปจริง; ลบไฟล์ที่ยังถูกอ้าง | task check | `node .claude/tests/harness/reference-governance.mjs .claude/skills && node --test .claude/tests/docs/skill-catalog.test.mjs && sh .claude/tests/docs/run-doc-consistency.sh && test "$(find .claude/skills -path '*/references/*' -name '*.md' -exec cat {} + \| wc -l)" -le 8500 && test "$(ls .claude/skills/ux-ui-principles/references/*.md \| wc -l)" -le 10` | T006 |
| รายงานมีสอง arm; run ไม่สำเร็จ; catalog ใหม่แย่ลง | task check | `node -e "const s=require('fs').readFileSync('docs/reports/2026-10-27-skill-catalog-trigger-evaluation.md','utf8');if(!/## Candidate/.test(s)\|\|!/## Regression/.test(s)\|\|/\bREGRESSION: yes\b/.test(s))process.exit(1)" && bash .claude/tests/run-all.sh` | T007 |
