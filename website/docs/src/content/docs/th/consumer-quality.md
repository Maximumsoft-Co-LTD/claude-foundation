---
title: Quality gate ของโปรเจกต์
description: เพิ่ม changed-code CRAP, mutation testing, language profile, baseline และ quality debt ให้ repository เดียวหรือหลายตัว
---

Foundation orchestrate quality tool ที่โปรเจกต์เป็นเจ้าของ โดยไม่สมมติว่า metric เดียวเหมาะกับทุกภาษา Feature นี้เป็น opt-in และเริ่มต้นแบบ **report-only**

```text
discover → preview config → ตรวจ tool → pilot report → อนุมัติ baseline → enforce
```

Quality finding เป็นหลักฐาน ไม่ใช่อำนาจแก้ code หากคะแนนสูงอยู่นอก Change ที่อนุมัติ ให้บันทึกเป็น debt โดยไม่ขยาย task หรือ repository scope

## Gate วัดอะไร

**CRAP Score** รวม cyclomatic complexity กับ coverage ระดับ function:

```text
CRAP = complexity² × (1 − coverage/100)³ + complexity
```

Foundation คำนวณคะแนนใหม่เอง ไม่เชื่อค่าที่ provider ส่งมาโดยตรง ค่าเริ่มต้นกำหนด coverage ของ changed unit code ที่ 80%, integration 70% และ critical journey 50% Function ใหม่ fail เมื่อ CRAP ตั้งแต่ 30 ขึ้นไป Function เดิม fail เมื่อแย่กว่า compatible baseline และ changed complexity เกิน 30 จะ fail เช่นกัน

**Automated mutation** ตรวจว่า test ปกติแยกแยะการเปลี่ยน code เล็ก ๆ ได้หรือไม่ เฉพาะ killed mutant ที่นับว่าผ่าน ส่วน survived, no-coverage, timeout, compile error, runtime error และ unavailable ไม่นับเป็น kill ระบบไม่สมมติว่า skipped mutant คือ equivalent การ suppress equivalent ต้องมีเหตุผลชัดเจนหรือ exception แคบที่ได้รับอนุมัติ

**Semantic mutation** ใช้ fault ที่ตรง domain เช่น ลบ tenant filter, ข้าม transaction, ไม่จัดการ returned error หรือทำ keyboard focus พัง โดยมี kill-rate threshold แยกจาก automated mutation รวม

## เริ่มอย่างปลอดภัย

Discovery อ่าน manifest กับชื่อไฟล์ แต่ไม่รัน command ของโปรเจกต์:

```bash
claude-foundation quality discover
claude-foundation quality init
claude-foundation quality init --write --ci github
claude-foundation quality doctor
```

`quality init` เป็น preview จนกว่าจะใส่ `--write` และจะสร้าง `quality/foundation-quality.json` เมื่อใช้ `--ci github` จะติดตั้ง:

- workflow changed-code แบบ reusable/manual;
- nightly inventory แบบสี่ shard; และ
- release workflow ที่ enforce full inventory

Reusable workflow ไม่ได้มี `pull_request` trigger ในตัว ต้องเรียกจาก PR workflow เดิมของ repository และส่ง Foundation Change ID เข้าไป เพิ่มขั้น setup runtime/tool ของแต่ละภาษาก่อน `quality doctor` เพราะ Foundation ไม่ติดตั้ง runtime หรือ quality tool ให้

รัน pilot ใน isolated workspace ของ Change:

```bash
claude-foundation quality run --change <change-id>
claude-foundation quality report
claude-foundation quality run --change <change-id> --enforce
```

เมื่อ commit quality config แล้ว evidence bootstrap สามารถต่อ enforced run เป็น provider `static-analysis` Receipt จะบันทึก aggregate assurance และเก็บ per-repository report ไว้ใน command log

## Language profile

| Surface | Profile | Control ที่เหมาะสม |
|---|---|---|
| JavaScript / TypeScript | `application-js-ts` | test, static, Istanbul + complexity, automated/semantic mutation |
| Go | `application-go` | `go test`, `go vet`, gocyclo + cover, mutation, compatibility, resilience |
| Python | `application-python` | pytest, static, Radon + coverage.py, mutation |
| PHP | `application-php` | Composer/PHPUnit, Clover, mutation |
| Bash | `script-bash` | test, ShellCheck/static, state identity, semantic fault |
| SQL | `database-sql` | isolated integration, compatibility, migration, performance, semantic fault |
| MongoDB | `database-mongodb` | isolated data fixture และ schema/query/migration fault |
| HTML | `web-markup` | validation, browser, accessibility evidence |
| CSS / Sass | `web-style` | lint/build, browser, accessibility, responsive evidence |

Foundation ตั้งใจ **ไม่สร้าง CRAP ปลอม** ให้ Bash, SQL, MongoDB, HTML, CSS หรือ Sass และสถานะ unsupported, unavailable หรือ unmapped จะไม่กลายเป็นศูนย์หรือ pass

## Provider และ built-in normalizer

โปรเจกต์เป็นเจ้าของทุก command และ tool version ที่ pin ไว้ Provider แบบ `command` ส่ง Foundation protocol ผ่าน stdout หรือ output file ส่วน `builtin` รัน command ของโปรเจกต์แล้ว normalize native report ด้วย adapter เหล่านี้:

- `javascript-istanbul`
- `go-complexity-cover`
- `python-radon-coverage`
- `php-clover`
- `canonical-functions`
- `generic-mutation-json`

CRAP และ mutation report ผูกกับ repository ID, commit, workspace digest, language, tool version, adapter version และ configuration digest Report จาก workspace อื่นหรือ tool config ที่ไม่ตรงจึงใช้เป็น baseline ของรอบปัจจุบันไม่ได้เงียบ ๆ

## Baseline, debt และ exception

ตรวจ pilot finding ก่อนสร้าง baseline:

```bash
claude-foundation quality baseline
claude-foundation quality baseline --write \
  --decision-ref ADR-42 --reason "approved pilot baseline"
```

Baseline แยก version ตาม repository และ capability การเปรียบเทียบ mutation จะ scope baseline ให้ตรง affected path ปัจจุบัน จึงไม่เอา mutant set จาก Change เก่ามาเทียบกับ Change ที่ไม่เกี่ยวกัน

สร้าง full inventory และ debt โดยไม่ขยาย Change ปัจจุบัน:

```bash
claude-foundation quality run --full
claude-foundation quality debt
```

Inventory ใหญ่แบ่งด้วย `--shard-index <เริ่มจากศูนย์>` และ `--shard-count <n>` Lane ถูกเลือกแบบ deterministic และ failed repository จะไม่ถูกค่าเฉลี่ยกลบ

Exception ต้องระบุ function หรือ mutant เดียว ห้าม glob และต้องมี owner, approver, risk, compensating evidence, tracking issue กับวันหมดอายุไม่เกิน 90 วัน

## ความปลอดภัยและ rollout

- Mutation ใช้ tool isolation หรือ Foundation Change sandbox; provider แบบ `harness-sandbox` ที่ไม่มี `--change` จะ unavailable
- Foundation เปรียบเทียบ Git status ก่อนและหลัง provider หากคืน workspace ไม่เหมือนเดิม lane จะ fail
- SQL/MongoDB provider ต้องใช้ database แยกต่อ run ห้ามใช้ shared หรือ production database
- Repository ที่ถูกเลือกแต่ไม่มี quality config จะ fail closed
- Capability ที่ขาดจะลด assurance และยังแสดงอยู่ แม้ policy อนุญาต compensating evidence

คง `policy.mode` เป็น `report` อย่างน้อยสามรอบที่เป็นตัวแทน ตรวจ function/path mapping กับ false positive อนุมัติ baseline เริ่มต้น แล้วค่อยเปิด enforcement ใน PR caller ให้ nightly ดูแล full debt inventory และ release ดูแล full enforced gate

