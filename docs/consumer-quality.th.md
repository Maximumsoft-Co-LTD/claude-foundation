# Consumer Quality: CRAP Score และ Mutation Testing

Foundation รัน quality tool ที่ project เป็นเจ้าของข้าม repository เดียวหรือหลายตัวได้ ระบบเริ่มต้นแบบ report-only และไม่มีอำนาจให้แก้ code นอก Change/spec ที่อนุมัติ

English version: [consumer-quality.md](consumer-quality.md)

## หลักประกัน

- CRAP รวม cyclomatic complexity กับ coverage ระดับ function และ Foundation คำนวณคะแนนใหม่เอง
- Automated mutation นับเฉพาะ behavioral kill; timeout, crash, compile/runtime error, no coverage, skipped และ unavailable ไม่ใช่ kill
- Semantic mutation ใช้ fault ที่ตรง domain เช่น ลบ tenant filter หรือข้าม transaction
- แต่ละ repository แยก commit, workspace, tool/config, baseline และ assurance โดยไม่มีการเฉลี่ยคะแนนกลบกัน
- legacy debt ที่ไม่เกี่ยวถูกบันทึกโดยไม่ block changed surface ปัจจุบัน
- unsupported, unavailable และ unmapped ไม่กลายเป็นศูนย์หรือ pass
- Quality finding เป็น evidence ไม่ใช่ scope authority การแก้นอก spec ทำให้ scope lane fail

สูตร CRAP คือ:

```text
CRAP = complexity² × (1 − coverage/100)³ + complexity
```

ค่าเริ่มต้นกำหนด changed unit coverage 80%, integration 70% และ critical journey 50% Function ใหม่ fail ที่ CRAP ตั้งแต่ 30, function เดิม fail เมื่อ CRAP แย่กว่า baseline และ changed complexity เกิน 30 จะ fail

## Onboard repository

Discovery อ่าน manifest และชื่อไฟล์โดยไม่รัน command ของ project:

```bash
claude-foundation quality discover
claude-foundation quality init
claude-foundation quality init --write --ci github
claude-foundation quality doctor
```

`quality init` เป็น preview จนกว่าจะใส่ `--write` และสร้าง `quality/foundation-quality.json` ส่วน `--ci github` จะคัดลอก workflow template แบบ reusable/manual changed-code, nightly สี่ shard และ full release ตัว changed-code template ต้องถูกเรียกจาก PR workflow เดิม เพราะไม่มี `pull_request` trigger ในตัว

สำหรับ JavaScript/TypeScript การ discovery รองรับ package script ที่ project เป็นเจ้าของทั้ง `foundation:quality:crap` และ alias `quality:crap` โดย command ต้องสร้าง `foundation-crap-v1` ที่ `.foundation/quality/crap.json` หากไม่มี script หรือ provider ที่ตั้งค่าไว้ CRAP จะมีสถานะว่ายังไม่ได้วัด

รันกับ isolated workspace ของ Change:

```bash
claude-foundation quality run --change <change-id>
claude-foundation quality report
claude-foundation quality run --change <change-id> --enforce
```

เมื่อ commit config แล้ว evidence bootstrap สามารถต่อ enforced run เป็น `static-analysis` evidence ผลอยู่ใต้ `.foundation/quality/results/` และห้าม commit

## Profile

| Surface | Profile | Control |
|---|---|---|
| JavaScript / TypeScript | `application-js-ts` | test, static, Istanbul + complexity, automated/semantic mutation |
| Go | `application-go` | test, vet, gocyclo + cover, mutation, compatibility, resilience |
| Python | `application-python` | pytest, static, Radon + coverage.py, mutation |
| PHP | `application-php` | Composer/PHPUnit, Clover, mutation |
| Bash | `script-bash` | test, static, state identity, semantic fault |
| SQL | `database-sql` | isolated integration, compatibility, migration, performance, semantic fault |
| MongoDB | `database-mongodb` | isolated data และ schema/query/migration fault |
| HTML | `web-markup` | validation, browser, accessibility |
| CSS / Sass | `web-style` | lint/build, browser, accessibility, responsive evidence |

Foundation ไม่สร้าง CRAP ปลอมให้ Bash, SQL, MongoDB, HTML, CSS หรือ Sass แต่ใช้ control ที่ตรง behavior ของ surface นั้น

## Provider และ adapter

Consumer project เป็นเจ้าของ executable และ version ทุกตัว Provider มีสองแบบ:

1. `command`: ส่ง JSON `foundation-crap-v1` หรือ `foundation-automated-mutation-v1` ผ่าน stdout หรือ `output`
2. `builtin`: รัน command ของ project แล้ว normalize native report

Built-in normalizer คือ `javascript-istanbul`, `go-complexity-cover`, `python-radon-coverage`, `php-clover`, `canonical-functions` และ `generic-mutation-json`

Report ผูก `repository`, `repositoryCommit`, `workspaceDigest`, `language` และ tool `name/version/adapterVersion/configDigest` โดย path ต้อง relative ต่อ repository ดู schema ที่ `.claude/harness/runtime/contracts/`

## Baseline, debt และ exception

หลัง pilot อย่างน้อยสามรอบที่เป็นตัวแทน ให้ตรวจ finding ก่อนสร้าง baseline:

```bash
claude-foundation quality baseline
claude-foundation quality baseline --write \
  --decision-ref ADR-42 --reason "approved pilot baseline"
```

Baseline แยก repository/capability และ compatible เฉพาะเมื่อ language, tool version, adapter version และ config digest ตรงกัน Automated mutation จะเทียบ baseline เฉพาะ affected surface ปัจจุบัน

Nightly inventory ใช้:

```bash
claude-foundation quality run --full
claude-foundation quality debt
```

งานใหญ่แบ่งด้วย `--shard-index <เริ่มจากศูนย์>` และ `--shard-count <n>` Exception ต้องระบุ function หรือ mutant เดียว ห้าม glob และต้องมี reason, risk, compensating evidence, owner, approver, tracking issue กับวันหมดอายุไม่เกิน 90 วัน

## ความปลอดภัยและ rollout

- Repository ที่ถูกเลือกแต่ไม่มี quality config จะ fail closed
- Profile capability ตั้ง `required: false` เพื่อหลบ gate ไม่ได้
- Capability ที่ขาดยังแสดง reduced assurance แม้ compensating evidence อนุญาตให้เดินต่อ
- Mutation ต้องประกาศ isolation แบบ `tool` หรือ `harness-sandbox`; แบบหลังต้องรันพร้อม `--change`
- Git status ก่อนและหลัง provider ต้องเหมือนกัน
- SQL/MongoDB provider ใช้ database แยกต่อ run ห้ามใช้ shared/production data
- HTML/style ใช้ browser/accessibility/visual evidence ไม่สร้าง code metric ปลอม

คง `policy.mode: report` ตลอด pilot ตรวจ mapping และ baseline ให้เสถียรก่อนเปิด PR enforcement ใช้ nightly ทำ full debt inventory และ release ทำ full enforced gate
