# Consumer Quality: CRAP Score และ Mutation Testing

เอกสารนี้อธิบายการเปิดใช้ quality gate ของ Foundation ใน repository ของผู้ใช้ ระบบทำงานแบบ report-only เป็นค่าเริ่มต้น และไม่มีอำนาจแก้ code เพิ่มจาก scope ที่ประกาศไว้ใน change/spec

## หลักการทำงาน

- CRAP รวม cyclomatic complexity กับ coverage ระดับ function เพื่อชี้ code ที่ทั้งซับซ้อนและพิสูจน์ได้น้อย
- Automated mutation เปลี่ยน code ชั่วคราวแล้วตรวจว่า test ฆ่า mutant ได้หรือไม่; timeout และ crash ไม่นับเป็น kill
- Semantic mutation ใช้ fault ที่ตรงกับ surface เช่น ลบ `WHERE`, ลบ tenant filter, ข้าม rollback หรือลบ focus state
- แต่ละ repository เป็น lane แยก มี tool identity, commit, config digest และ baseline ของตัวเอง ไม่มีการเฉลี่ยคะแนนเพื่อกลบ lane ที่ fail
- legacy debt ที่ไม่เกี่ยวกับ changed surface ถูกบันทึกเป็น debt แต่ไม่ block change ปัจจุบัน
- `unsupported`, `unavailable` และ `unmapped` ไม่ถูกตีความเป็น pass หรือศูนย์

## เริ่มใช้งาน

ตรวจ topology และ capability โดยไม่รัน project command:

```bash
claude-foundation quality discover
claude-foundation quality init
claude-foundation quality init --write --ci github
claude-foundation quality doctor
```

`quality init` เป็น preview จนกว่าจะใส่ `--write` และสร้าง `quality/foundation-quality.json` เมื่อใช้ `--ci github` จะติดตั้ง workflow สำหรับ PR, nightly และ release เพิ่มด้วย โดยไม่เขียนทับไฟล์เดิมหากไม่มี `--force`

รัน changed-code gate ใน sandbox ของ change:

```bash
claude-foundation quality run --change <change-id>
claude-foundation quality run --change <change-id> --enforce
claude-foundation quality report
```

เมื่อ config ถูก commit แล้ว Harness จะเพิ่ม `static-analysis` evidence candidate ที่รัน quality gate ให้ change โดยอัตโนมัติ ผลอยู่ที่ `.foundation/quality/results/` และโฟลเดอร์นี้ไม่ควร commit

## ภาษาและ profile

| Surface | Profile | วิธีตรวจหลัก |
|---|---|---|
| JavaScript / TypeScript | `application-js-ts` | test, static, Istanbul + complexity, mutation |
| Go | `application-go` | `go test`, `go vet`, gocyclo + cover, mutation |
| Python | `application-python` | pytest, static, Radon + coverage.py, mutation |
| PHP | `application-php` | Composer/PHPUnit, Clover, mutation |
| Bash | `script-bash` | test, ShellCheck/static, state identity, semantic faults |
| SQL | `database-sql` | isolated integration, compatibility, migration and semantic faults |
| MongoDB | `database-mongodb` | isolated data fixture, schema/query/migration faults |
| HTML | `web-markup` | validation, browser and accessibility evidence |
| CSS / Sass | `web-style` | lint/build, browser, accessibility and responsive evidence |

CRAP ไม่ถูกสร้างขึ้นปลอม ๆ ให้ Bash, SQL, MongoDB, HTML, CSS หรือ Sass เพราะ metric นี้ไม่เหมาะกับ surface เหล่านั้น ระบบจะใช้ capability ที่ตรงชนิดงานแทน

## Provider และ adapter

Harness ไม่ติดตั้ง tool ของภาษา ผู้ใช้เป็นเจ้าของ version และ command ใน repo provider มีสองแบบ:

1. `command` รันคำสั่งแล้วอ่าน JSON protocol มาตรฐานจาก stdout หรือ `output`
2. `builtin` รัน command ของ project (ถ้ามี) แล้ว normalize report ผ่าน adapter

Built-in adapter ที่มีให้:

- `javascript-istanbul`: complexity JSON + Istanbul coverage JSON
- `go-complexity-cover`: gocyclo text + `go tool cover -func` text
- `python-radon-coverage`: Radon JSON + coverage.py JSON
- `php-clover`: PHPUnit Clover XML
- `canonical-functions`: language ใดก็ได้ที่ส่ง function complexity/coverage แบบ canonical
- `generic-mutation-json`: Stryker-like หรือ canonical mutant JSON ใช้ได้กับ JS/TS, Go, Python และ PHP

ตัวอย่าง:

```json
{
  "kind": "builtin",
  "adapter": "python-radon-coverage",
  "language": "python",
  "command": ["./scripts/generate-python-quality-reports"],
  "inputs": {
    "complexity": ".foundation/quality/radon.json",
    "coverage": ".foundation/quality/coverage.json"
  },
  "tool": { "name": "radon+coverage", "version": "pinned-by-project" },
  "isolation": "read-only"
}
```

Adapter ใหม่ควร output `foundation-crap-v1` หรือ `foundation-automated-mutation-v1` พร้อม `repository`, `repositoryCommit`, `language`, tool `name/version/adapterVersion/configDigest` และ path แบบ repository-relative ดู schema ใน `.claude/harness/runtime/contracts/`

## Baseline, debt และ exception

หลังตรวจ pilot report และยืนยันผลแล้วจึงสร้าง baseline แบบ explicit:

```bash
claude-foundation quality baseline
claude-foundation quality baseline --write --decision-ref ADR-42 --reason "approved pilot baseline"
```

Baseline แยกตาม repository/capability และใช้ได้ต่อเมื่อ language, tool version, adapter version และ config digest ตรงกัน การเปลี่ยน tool ต้อง review และสร้าง baseline ใหม่ ไม่ควร copy ค่าเดิมโดยไม่ตรวจ

Nightly ใช้:

```bash
claude-foundation quality run --full
claude-foundation quality debt
```

งาน full ที่ใหญ่แบ่ง lane แบบ deterministic ได้ด้วย `--shard-index <0-based>`
และ `--shard-count <n>` โดย GitHub nightly template แบ่งไว้สี่ shard

Exception ต้องระบุ function หรือ mutant เดียว ห้าม glob ต้องมี owner, approver, risk, compensating evidence, tracking issue และวันหมดอายุไม่เกิน 90 วัน

## ขอบเขตและความปลอดภัย

Quality finding เป็น evidence ไม่ใช่ authority หากพบคะแนนสูงนอก spec ให้บันทึกใน debt แล้วหยุดที่ขอบเขตเดิม การแก้เพิ่มต้องเปิด/แก้ change พร้อม approval ก่อน ระบบตรวจ changed surface กับ task scope และทำ lane `scope: fail` เมื่อพบไฟล์นอกขอบเขต Mutation provider ต้องประกาศ isolation เป็น `tool` หรือ `harness-sandbox`; หาก working tree หลังรันไม่เหมือนก่อนรัน lane จะ fail

สำหรับ SQL/MongoDB ให้ใช้ database ชั่วคราวที่แยกต่อ run ห้ามชี้ shared database หรือ production credential จาก provider ส่วน browser/visual evidence ต้องผูกกับ acceptance claim ไม่ควรนำ pixel difference ไปแปลงเป็น CRAP

## การ rollout

เริ่มด้วย `policy.mode: report` อย่างน้อยสามรอบ ตรวจ mapping และ false positive จากนั้นเก็บ baseline ที่มี decision reference แล้วจึงเปิด `--enforce` ใน PR Nightly ทำ full inventory ส่วน release รัน full gate แบบ enforce หากภาษาใดยังไม่มี adapter ให้คงสถานะ unsupported พร้อม compensating evidence ตาม risk ห้ามตั้งค่าคะแนนสมมติเป็นศูนย์เพื่อให้ผ่าน
