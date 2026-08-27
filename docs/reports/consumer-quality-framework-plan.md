# Consumer Quality Framework Plan

> Status: Proposed
> Scope: Quality controls delivered to projects that adopt Foundation Harness
> Date: 2026-08-27

## 1. เป้าหมาย

พัฒนา Foundation Harness ให้ตรวจคุณภาพโค้ดของ consumer project ได้ในสภาพแวดล้อมที่มีหลายภาษาและหลาย repository โดยใช้ CRAP Score และ mutation testing เฉพาะกับพื้นผิวที่เหมาะสม พร้อมรักษาหลักการต่อไปนี้:

- spec และ user intent มีอำนาจเหนือ quality metric;
- quality finding ไม่ให้อำนาจ Agent แก้โค้ดนอก approved scope;
- legacy debt ไม่ block change ที่ไม่เกี่ยวข้อง;
- missing, unsupported, unavailable และ unmapped evidence ต้องไม่ถูกแปลงเป็น pass;
- แต่ละ repository ใช้เครื่องมือเฉพาะภาษาได้ แต่ส่งผลผ่าน protocol กลาง;
- aggregate score ต้องไม่กลบ failure ของ repository หรือ critical behavior;
- mutation ต้องทำใน isolated workspace และไม่แก้ source checkout จริง;
- evidence ทุกชิ้นต้องผูกกับ repository, commit, workspace และ configuration ที่ใช้รัน

เป้าหมายปลายทาง:

```text
Discover repositories and languages
        ↓
Create a quality profile per repository
        ↓
Resolve changed surfaces from the approved spec
        ↓
Select language adapters and evidence providers
        ↓
Run tests, static checks, coverage, CRAP and mutation
        ↓
Normalize results into Foundation protocols
        ↓
Apply changed-code and affected-mutant ratchets
        ↓
Expose results in Prove, Review and Land
```

## 2. สถานะปัจจุบัน

Harness มีโครงสร้างที่นำกลับมาใช้ได้แล้ว:

- evidence provider และ command adapter;
- `foundation-mutation-v2` สำหรับ semantic mutation;
- repository topology และ cross-repository contracts;
- sandbox/worktree และ workspace identity;
- changed-surface calculation;
- risk-based review, acceptance, proof และ Land gates;
- internal JavaScript coverage, complexity, CRAP และ mutation tooling;
- versioned baselines, changed-code ratchets และ quality summaries

อย่างไรก็ตาม quality tooling ปัจจุบันใช้ตรวจ repository `claude-foundation` เอง และมี production paths/test commands ที่ผูกกับ repository นี้ ยังไม่ใช่ consumer-facing, multi-language adapter framework

## 3. Architecture

Harness core ต้องไม่ผูกกับ npm, Stryker หรือเครื่องมือของภาษาใดโดยตรง:

```text
Language-specific tool
        ↓
Quality adapter
        ↓
Foundation normalized protocol
        ↓
Policy evaluator
        ↓
Evidence receipt and lifecycle gate
```

ความรับผิดชอบแบ่งเป็น:

| Component | Responsibility |
|---|---|
| Harness core | Protocol validation, orchestration, isolation, policy, evidence freshness และ reporting |
| Repository profile | ภาษา, paths, commands, risk profile และ CI budget |
| Language adapter | อ่าน native report และ map เป็น function/mutant records |
| Project tooling | Test, coverage, complexity, mutation, lint และ domain-specific checks |
| Reviewer | ตรวจความหมายของ assertions, survivors, exceptions และ scope |

## 4. Protocols ที่ต้องเพิ่ม

### 4.1 `foundation-quality-capabilities-v1`

รายงาน capability ต่อ repository:

```json
{
  "protocol": "foundation-quality-capabilities-v1",
  "repository": "api",
  "language": "go",
  "capabilities": {
    "test": "available",
    "coverage": "available",
    "complexity": "available",
    "crap": "available",
    "automatedMutation": "available",
    "semanticMutation": "available"
  }
}
```

สถานะมาตรฐาน:

- `available` — adapter และ tool พร้อมใช้งาน;
- `unsupported` — ยังไม่มี adapter ที่น่าเชื่อถือ;
- `unavailable` — มี adapter แต่ environment/tool ไม่พร้อม;
- `unmapped` — มีข้อมูล แต่ map กับ source/function ไม่ได้;
- `not-applicable` — metric ไม่เหมาะกับ surface นี้และมีเหตุผล;
- `failed` — provider รันหรือตรวจผลไม่สำเร็จ

ห้ามแปลง `unsupported`, `unavailable` หรือ `unmapped` เป็นคะแนนศูนย์หรือ pass

### 4.2 `foundation-crap-v1`

ผลมาตรฐานระดับฟังก์ชัน:

```json
{
  "protocol": "foundation-crap-v1",
  "repository": "api",
  "language": "go",
  "tool": {
    "name": "adapter-name",
    "version": "1.0.0",
    "configDigest": "sha256:..."
  },
  "functions": [
    {
      "id": "internal/auth.Authorize",
      "path": "internal/auth/auth.go",
      "line": 42,
      "endLine": 87,
      "complexity": 12,
      "coverageKind": "branch",
      "coveragePercent": 85,
      "crap": 12.41,
      "mapping": "exact"
    }
  ]
}
```

Adapter หา function identity, complexity และ coverage mapping ส่วน Harness คำนวณ CRAP และตัดสิน policy

### 4.3 `foundation-automated-mutation-v1`

ผลมาตรฐานจาก mutation engine:

```json
{
  "protocol": "foundation-automated-mutation-v1",
  "repository": "frontend",
  "mutants": [
    {
      "id": "src/auth.ts:42:conditional-boundary",
      "path": "src/auth.ts",
      "line": 42,
      "operator": "conditional-boundary",
      "status": "killed",
      "killedBy": ["CASE-EXPIRED-TOKEN-REFUSED"]
    }
  ]
}
```

สถานะ mutant กลาง:

- `killed`;
- `survived`;
- `no-coverage`;
- `timeout`;
- `compile-error`;
- `runtime-error`;
- `ignored-equivalent`;
- `unavailable`

Semantic mutation ใช้ `foundation-mutation-v2` ที่มีอยู่แล้ว และต้องคงกฎ expected killer, exact application, compile/load verification, isolation และ restoration

## 5. Consumer Quality Policy

Policy เริ่มต้นที่เสนอ:

```yaml
quality:
  authority: evidence-only
  enforcement: changed-code-ratchet

  coverage:
    unitChangedMinimum: 80
    integrationChangedMinimum: 70
    criticalJourneyMinimum: 50

  complexity:
    warning: 11
    refactor: 21
    maximumChanged: 30

  crap:
    warning: 20
    maximumNew: 30
    rejectRegression: true

  mutation:
    rejectScoreRegression: true
    rejectNewNoCoverage: true
    changedCodeTarget: 70
    semanticKillRate: 100
```

`changedCodeTarget: 70` เริ่มต้นเป็น candidate target ไม่ใช่ absolute gate จนกว่าจะมี baseline ที่เสถียร

### 5.1 Risk-based fallback

| Risk | Missing CRAP behavior |
|---|---|
| Low | อนุญาต static/test/coverage/mutation fallback |
| Medium | ต้องมี compensating evidence ตาม policy |
| High | Block เมื่อ required capability หาย หรือขอ approved exception |
| Critical | ต้องมี named critical cases และ semantic mutation ที่เกี่ยวข้อง |

Fallback assurance ต้องแสดงเป็น `reduced` ห้ามแสดงเป็น full assurance

### 5.2 Exception policy

Exception ต้องเจาะจง repository, path, function หรือ mutant และมี:

- technical reason;
- risk ที่อาจหลุด;
- compensating evidence;
- owner และ approver;
- tracking issue;
- วันหมดอายุไม่เกิน 90 วัน;
- configuration digest ที่ exception อ้างอิง

Harness ห้ามสร้างหรืออนุมัติ exception เอง

## 6. Scope Safety

### 6.1 Approved scope

แต่ละ change ต้องประกาศ write scope:

```yaml
scope:
  repositories:
    - api
  include:
    - services/auth/**
    - tests/auth/**
  allowedSupportingChanges:
    - shared/errors/**
  exclude:
    - services/payment/**
```

Quality providers อ่านข้อมูลกว้างขึ้นเพื่อสร้าง inventory ได้ แต่ production/test writes ต้องอยู่ใน approved scope

### 6.2 Finding classification

| Finding | Enforcement |
|---|---|
| New violation | Block และแก้ภายใน spec |
| Changed regression | Block หรือคืนค่าไม่ให้แย่ลง |
| Touched legacy debt ที่ไม่แย่ลง | ผ่านพร้อม debt |
| Unrelated legacy debt | Report only; ห้าม Agent แก้ |

### 6.3 Remediation budget

```yaml
qualityRemediation:
  mode: changed-code-only
  maxAdditionalFiles: 3
  allowBehaviorPreservingRefactor: true
  allowPublicContractChange: false
  allowCrossRepositoryExpansion: false
```

หากต้องเกิน budget ให้คืน `BLOCKED_BY_SCOPE` พร้อมทางเลือก: เพิ่ม test ภายใน scope, narrow exception, ขอขยาย spec หรือเปิด refactoring change ใหม่

### 6.4 Land guard

ก่อน Land ต้องตรวจ:

- changed paths เป็น subset ของ approved scope;
- quality-driven edits ทุกไฟล์ผูกกับ claim หรือ acceptance criterion;
- debt findings ไม่ถูกปะปนเป็น implementation edits;
- evidence ยังตรงกับ commits และ workspace ปัจจุบัน;
- mutation ไม่ทิ้ง source modification ไว้

## 7. Multi-repository Design

### 7.1 Profiles ต่อ repository

```yaml
repositories:
  - id: frontend
    root: apps/frontend
    profiles:
      - application-js-ts
      - web-markup
      - web-style

  - id: api
    root: services/api
    profiles:
      - application-go
      - database-sql

  - id: worker
    root: services/worker
    profiles:
      - application-python
```

หนึ่ง repository มีหลาย profile ได้ และ provider ทุกตัวต้องระบุ repository identity

### 7.2 Baseline namespace

```text
quality/baselines/
  frontend/
    javascript-crap-v1.json
    mutation-v1.json
  api/
    go-crap-v1.json
    mutation-v1.json
  worker/
    python-crap-v1.json
    mutation-v1.json
```

Baseline ต้องผูกกับ repository, language, tool version, adapter version, configuration digest และ base commit

### 7.3 Aggregation

ห้ามเฉลี่ย mutation หรือ CRAP score ข้าม repository เพื่อใช้เป็น release verdict:

- `PASS` เมื่อ required lanes ทุกตัวผ่าน;
- `FAIL` เมื่อ required lane อย่างน้อยหนึ่งตัวล้ม;
- `REDUCED` เมื่อใช้ fallback ที่ policy อนุญาต;
- `UNAVAILABLE` เมื่อ required evidence ขาด

### 7.4 Cross-repository routing

เมื่อ shared contract/schema เปลี่ยน ต้องรัน producer tests, consumer tests, compatibility checks, contract digest และ semantic mutants ที่เกี่ยวข้อง โดยผูกผลกับ commits ของทุก repository

## 8. Adapter Framework

Adapter SDK ต้องมี interface เชิงแนวคิด:

```text
detect()
validateConfig()
collectCoverage()
collectComplexity()
collectMutation()
normalize()
diagnose()
```

Adapter ไม่ตัดสิน policy เอง หน้าที่ของ adapter คืออ่าน native report และสร้าง Foundation protocol ที่ validate ได้

### 8.1 Custom command adapter

ต้องมีตั้งแต่ MVP เพื่อให้ภาษาใหม่ใช้งานได้โดยไม่รอ built-in support:

```yaml
providers:
  complexity:
    command: ./scripts/quality-complexity
    protocol: foundation-crap-v1

  mutation:
    command: ./scripts/quality-mutation
    protocol: foundation-automated-mutation-v1
```

Harness ต้องตรวจ schema, repository identity, workspace binding, tool version และ config digest

## 9. Language and Surface Profiles

| Profile | CRAP | Automated mutation | Semantic mutation | Primary controls |
|---|---:|---:|---:|---|
| JavaScript/TypeScript | Full | Full | Full | Test, coverage, type/static, CRAP, mutation |
| Go | Full | Full | Full | Compile, test/race, coverage, CRAP, mutation |
| Python | Full | Full | Full | Type/static, test, coverage, CRAP, mutation |
| PHP | Full | Full | Full | Static, test, coverage, CRAP, mutation |
| Bash | Advisory | Limited | Full | Syntax, shell static, behavior, state identity |
| SQL | Stored procedures only | Not general | Full | Schema, migration, compatibility, query behavior |
| MongoDB | Not applicable | Not general | Full | Schema, index, query, migration, transaction |
| HTML | Not applicable | Not applicable | DOM behavior only | Validation, accessibility, browser |
| CSS/Sass | Not applicable | Not applicable | Not general | Lint, compile, visual and responsive checks |

### 9.1 JavaScript/TypeScript

- refactor internal JavaScript tooling เป็น reusable adapter;
- รองรับ JS, MJS, CJS, TS, TSX และ JSX;
- map generated coverage/mutants กลับไป TypeScript source maps;
- รองรับ branch/function coverage, complexity, CRAP และ changed mutation;
- รายงาน `unmapped` เมื่อ source mapping ไม่แน่นอน

### 9.2 Go

- route ตาม package และ interface impact;
- test, coverage, complexity และ CRAP;
- automated/semantic mutation;
- race/concurrency evidence สำหรับ affected changes;
- compatibility evidence สำหรับ public interfaces

### 9.3 Python

- branch coverage และ function/method/async mapping;
- decorators และ import-time behavior;
- complexity, CRAP, automated/semantic mutation;
- isolated environment สำหรับ modules ที่มี side effects

### 9.4 PHP

- syntax/static analysis;
- unit/integration coverage;
- complexity, CRAP และ mutation;
- focused framework bootstrap เพื่อควบคุม mutation runtime

### 9.5 Bash

- syntax และ shell static analysis;
- exit code, stdout/stderr และ filesystem assertions;
- cleanup/restoration checks;
- semantic mutants เช่น skipped validation, inverted status, removed quoting และ skipped cleanup;
- CRAP เป็น advisory จน coverage mapping เสถียร

### 9.6 SQL

- dialect declaration;
- syntax, forward/rollback migration และ idempotency;
- schema compatibility, constraints, data preservation และ transactions;
- query plan/performance budget;
- semantic mutations เช่น removed `WHERE`, changed join, skipped transaction และ removed constraint;
- CRAP เฉพาะ procedural stored code ที่มี coverage ที่เชื่อถือได้

### 9.7 MongoDB

- document schema validation;
- indexes และ uniqueness;
- filters, aggregation pipeline และ transaction/session behavior;
- migrations และ backfills;
- isolated database/collection fixtures;
- semantic mutants เช่น removed tenant filter, `$and`→`$or`, removed index และ reordered pipeline stage

### 9.8 HTML/CSS/Sass

- HTML validation, semantics, accessibility, keyboard behavior และ browser journeys;
- CSS/Sass syntax, lint, compilation, design-token policy และ responsive checks;
- contrast, reduced motion และ visual regression;
- inline/extracted JavaScript ใช้ JS/TS profile แยก;
- ไม่สร้าง CRAP score สำหรับ markup และ stylesheets

## 10. Lifecycle Integration

### 10.1 Change

ระบุ repositories, languages, affected profiles, critical cases, required semantic mutants, fallback plan, exceptions และ CI time budget ก่อนเริ่ม Build

### 10.2 Build

รัน focused evidence:

1. affected tests;
2. changed-code coverage;
3. changed-function complexity/CRAP;
4. affected automated mutants;
5. required semantic mutants

Latency targets:

- static/coverage/CRAP ไม่เกิน 5 นาที;
- changed-scope automated mutation ไม่เกิน 10 นาที

### 10.3 Prove

สร้าง immutable evidence ที่มี repository commit, workspace hash, provider/tool/config versions, changed functions, CRAP delta, mutation delta, fallback assurance, exceptions และ scope violations

### 10.4 Review

Reviewer ตรวจ observable assertions, coverage quality, CRAP causes, survived/equivalent mutants, expected semantic killers และ quality-driven edits นอก spec

### 10.5 Land

ตรวจ evidence freshness, approved paths, required lanes, high-risk fallback approval, critical survivors, expired exceptions และ workspace restoration

## 11. CLI and User Experience

เพิ่มคำสั่ง:

```text
foundation quality discover
foundation quality init
foundation quality doctor
foundation quality run
foundation quality report
foundation quality baseline
foundation quality debt
```

### `quality discover`

ทำ read-only detection ของ repositories, languages, build files, test frameworks, coverage/mutation capabilities และ production/test/generated paths

### `quality init`

สร้าง draft configuration ให้ผู้ใช้ยืนยัน paths, commands, profiles, thresholds และ CI budgets ห้ามรัน mutation ในขั้น discover/init

### `quality doctor`

ตรวจ adapter/tool availability, report parsing, function mapping, sandbox isolation, baseline compatibility, semantic killer binding และ multi-repo topology

### PR summary

```text
Repo       Profile       Coverage  CRAP   Mutation  Assurance  Result
frontend   JS/TS         86%       pass   74%       full       pass
api        Go            81%       pass   67%       full       pass
installer  Bash          n/a       adv.   3/3       reduced    pass
styles     CSS/Sass      n/a       n/a    n/a       visual     pass
```

## 12. CI Strategy

### Pull Request

1. config/schema validation;
2. affected deterministic tests;
3. changed coverage/complexity/CRAP;
4. required semantic mutation;
5. changed-scope automated mutation;
6. approved-scope diff validation;
7. unified per-repository summary;
8. blocking quality gate

### Main

- deterministic tests ของ required repositories;
- complete changed-code comparison;
- required semantic mutants;
- trend recording

### Nightly

- full eligible mutation แบบ shard;
- full CRAP inventory;
- survived/no-coverage inventory;
- adapter health และ flaky-baseline detection;
- deduplicated quality-debt update;
- target ไม่เกิน 60 นาทีต่อ shard

### Release

- fresh evidence;
- all required semantic mutants;
- no critical survivor;
- no expired exception;
- protocol/tool/config compatibility;
- packaging/deployment evidence

## 13. Test Strategy

สร้าง fixture projects:

```text
fixtures/quality/
  javascript/
  typescript/
  go/
  python/
  php/
  bash/
  sql/
  mongodb/
  html-css-sass/
  polyglot-multi-repo/
```

แต่ละ adapter ต้องทดสอบ:

- pass และ threshold failure;
- missing tool และ malformed report;
- zero coverage, unmapped และ unsupported;
- survived, no-coverage, timeout และ crash;
- equivalent-mutant suppression;
- stale baseline และ config mismatch;
- source restoration;
- out-of-spec finding;
- cross-repository routing

Polyglot E2E ขั้นต่ำ:

```text
TypeScript frontend
  → Go API
    → MongoDB migration
      → Bash deployment
```

การเปลี่ยน shared contract ต้องเลือก providers ครบทุก affected repository และไม่รัน lane ที่ไม่เกี่ยวข้อง

## 14. Delivery Plan

### Phase 0 — Protocol and Safety (1–2 สัปดาห์)

- protocols และ schemas;
- capability states;
- policy/fallback;
- scope authority และ remediation budget;
- baseline identity;
- protocol fixtures

Exit criteria:

- missing capability ไม่กลายเป็น pass;
- quality finding ไม่ขยาย write scope;
- multi-repo results แยก identity

### Phase 1 — Core Framework (2 สัปดาห์)

- adapter SDK;
- custom command adapter;
- normalizer และ policy evaluator;
- evidence integration;
- result aggregator;
- `quality discover/init/doctor`;
- summary renderer

Exit criteria: consumer repo ที่มี custom commands ใช้งานได้โดยไม่แก้ Harness core

### Phase 2 — JavaScript/TypeScript (1–2 สัปดาห์)

- reusable JS adapter;
- TypeScript/source-map support;
- JS/TS profiles;
- changed mutation selection;
- consumer fixtures

Exit criteria: external JS/TS repository ผ่าน full CRAP/mutation lifecycle

### Phase 3 — Go, Python and PHP (3–4 สัปดาห์)

- built-in adapters;
- function/coverage mapping;
- changed-code gates;
- mutation isolation;
- adapter-specific fixtures

Exit criteria: mapping และ baselines เสถียรสามรอบ

### Phase 4 — Bash, SQL and MongoDB (2–3 สัปดาห์)

- Bash safety profile;
- SQL migration/query profile;
- MongoDB schema/query/migration profile;
- semantic mutant catalogs;
- isolated data fixtures

Exit criteria: ไม่มี CRAP ปลอม และ data mutations ไม่แตะ shared database

### Phase 5 — HTML, CSS and Sass (1–2 สัปดาห์)

- validation/build/lint;
- accessibility/browser evidence;
- visual/responsive evidence;
- presentation-specific summary

Exit criteria: presentation quality แยกจาก code metrics ชัดเจน

### Phase 6 — Multi-repo Rollout (2 สัปดาห์)

- affected graph routing;
- cross-repo aggregation;
- PR/nightly/release templates;
- report-only pilot;
- baseline migration;
- consumer and adapter-authoring documentation

ประมาณการรวม 10–15 สัปดาห์สำหรับทีมขนาดเล็ก หากต้องการ built-in adapters ครบทุก profile โดยเปิด consumer pilot ได้หลัง Phase 2

## 15. Prioritized Backlog

### P0 — Required before consumer enforcement

- QF-001 Quality capability protocol;
- QF-002 CRAP protocol;
- QF-003 Automated mutation protocol;
- QF-004 Unsupported/unavailable/unmapped states;
- QF-005 Per-repository profiles;
- QF-006 Scope-bound remediation guard;
- QF-007 Changed-code ratchet;
- QF-008 Custom command adapter;
- QF-009 Evidence/workspace binding;
- QF-010 Quality discover/init/doctor;
- QF-011 JavaScript/TypeScript reference adapter;
- QF-012 Multi-repository lane summary

### P1 — Application stack

- QF-013 Go adapter;
- QF-014 Python adapter;
- QF-015 PHP adapter;
- QF-016 Per-repository baselines;
- QF-017 Affected mutation selection;
- QF-018 Nightly sharding;
- QF-019 Quality debt inventory;
- QF-020 Exception approval and expiry

### P2 — Specialized surfaces

- QF-021 Bash safety profile;
- QF-022 SQL migration/query profile;
- QF-023 MongoDB profile;
- QF-024 HTML accessibility profile;
- QF-025 CSS/Sass visual profile;
- QF-026 Polyglot E2E fixture;
- QF-027 Adapter authoring guide

## 16. Definition of Done

ระบบถือว่าเสร็จเมื่อ:

- รองรับหลาย repository ด้วย identity และ baseline แยกกัน;
- JS/TS, Go, Python และ PHP รองรับ CRAP และ mutation;
- Bash ใช้ safety/semantic profile;
- SQL/MongoDB ใช้ data/migration profiles;
- HTML/CSS/Sass ใช้ browser/accessibility/visual profiles;
- ผู้ใช้เพิ่มภาษาใหม่ผ่าน custom adapter ได้;
- missing capability ไม่ถูกตีความเป็น pass;
- aggregate score ไม่กลบ failed repository;
- legacy debt ไม่ block unrelated change;
- quality finding ไม่ทำให้ Agent แก้นอก spec;
- mutation ไม่แก้ source checkout จริง;
- crash/timeout ไม่ถูกนับเป็น behavioral kill;
- evidence ผูกกับ repository commit และ workspace;
- Prove, Review และ Land แสดง assurance level;
- PR ใช้ changed scope และอยู่ใน latency budget;
- nightly สร้าง full inventory และ debt report;
- มี migration guide และ adapter authoring documentation

## 17. Recommended First Slice

เริ่มจาก QF-001 ถึง QF-012:

1. Protocols และ schemas;
2. capability negotiation;
3. scope safety และ changed-code ratchet;
4. custom command adapter;
5. reusable JS/TS adapter;
6. per-repository report;
7. report-only consumer pilot

อย่าเปิด blocking enforcement จนกว่า adapter/report จะเสถียรอย่างน้อยสามรอบ ผู้ใช้ตรวจ top findings แล้ว และ missing/unmapped/source-restoration cases ผ่าน regression tests ครบ

## 18. Implementation Status (2026-08-27)

แผนนี้ถูก implement ใน Harness แล้วครบ QF-001–QF-027 โดยมีจุดเชื่อมหลักดังนี้:

| Backlog | Implementation |
|---|---|
| QF-001–QF-004 | versioned JSON schemas และ validator ใน `runtime/contracts/` และ `runtime/quality/quality-protocol.mjs` |
| QF-005–QF-010 | per-repo profiles, scope/risk policy, custom providers, workspace binding และ `quality discover/init/doctor` |
| QF-011–QF-015 | built-in CRAP normalizers สำหรับ JS/TS, Go, Python, PHP และ generic automated-mutation adapter |
| QF-016–QF-020 | reviewed baselines, affected/full selection, deterministic nightly shards, debt inventory และ expiring exceptions |
| QF-021–QF-025 | Bash, SQL, MongoDB, HTML และ CSS/Sass profiles พร้อม semantic fault/control catalogs โดยไม่สร้าง CRAP ปลอม |
| QF-026 | committed polyglot multi-repository fixture: TypeScript → Go → SQL/MongoDB → Bash รวม markup/style surface |
| QF-027 | consumer rollout และ adapter-authoring guide ที่ `docs/consumer-quality.md` |

ค่าเริ่มต้นยังเป็น report-only ตามแผน การติดตั้งไม่เพิ่ม language tool ให้ consumer;
`quality doctor` ตรวจ tool ที่ project pin ไว้ และ enforcement ต้องถูกเปิดอย่างชัดเจน
หลัง pilot/baseline review เท่านั้น GitHub templates สำหรับ PR, nightly และ release
สร้างได้ด้วย `quality init --write --ci github`
