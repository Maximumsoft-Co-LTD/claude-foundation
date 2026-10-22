# Smoke ของ candidate: `497ab55fb` เทียบ v3.6.7 และไม่มี harness — 2026-10-22

**สถานะ:** หลักฐาน smoke ที่สังเกตได้ n=1 ห้า scenario รายงานแยกเป็นรายงาน ไม่ใช่ checkpoint
แบบจ่ายเงินครบชุดและไม่ใช่การรับรองแบบรันซ้ำ รายงานนี้ไม่บันทึกการตัดสินใจออกเวอร์ชัน
[English](scenario-smoke-candidate-497ab55fb-2026-10-22.md)

## ขอบเขตและเงื่อนไข

| รายการ | ค่า |
|---|---|
| Candidate | `497ab55fbd5caa8425f8c9b697c0db4a3d64bc71` (สะอาด) หน้าอนุมัติแบบเริ่มที่การตัดสินใจพร้อมการ์ดตามชนิดงาน, work type `data-fix`/`security`/`cicd`, คำตอบบังคับที่ใช้ `none:`/`unknown:` พร้อมเหตุผลได้, กฎ undo ระดับ High/Critical, ข้อสังเกตเรื่อง path เสี่ยง |
| Previous | `a8d3d4b770d7396a73a8dd69dc0fd23ae50e49b4` (tag `v3.6.7`) สะอาด ใช้ worktree แยกพร้อม `npm ci` และ installer ของตัวเอง |
| ไม่มี harness | `--arm baseline` จาก tree ของ candidate: seed, oracle, โมเดลและเพดานเหมือนกัน ไม่มี Change Loop |
| โมเดล | `claude-sonnet-5-5` ผ่าน `ANTHROPIC_MODEL` เหมือนกันทุก arm |
| Scenario | `owner-only-delete`, `idempotent-refund`, `speed-up-search`, `regression-fix-with-fixes`, `tiny-feature` |
| จำนวนรอบ | หนึ่งรอบต่อช่อง สลับลำดับ arm ในแต่ละ scenario ช่องแรก (candidate, `owner-only-delete`) รันด้วยมือด้วยคำสั่งเดียวกัน อีก 14 ช่องรันโดยตัวควบคุมที่ทำงานทีละ run |
| สิทธิ์ใช้จ่าย | ผู้ใช้กำหนดเพดาน US$40 หนึ่งรอบต่อช่อง ห้า scenario ตัวควบคุมไม่เริ่ม run ที่เพดานของมันจะทำให้ยอดที่วัดได้เกินเพดานรวม |
| Review | lab ให้สิทธิ์ main-session self-review และ Land ใน workspace ใช้แล้วทิ้ง จึงไม่มี reviewer อิสระและไม่มีค่า reviewer ในตัวเลขเหล่านี้ |
| Host | Claude Code เท่านั้น ไม่ได้ทดสอบ OpenCode, Cursor, Gemini |

เพดานต่อ run มาจาก matrix: US$5 สำหรับ `tiny-feature` และ US$3 สำหรับอีกสี่งาน

## ผล

ทั้ง 15 ช่องผ่าน hidden oracle และ `strictPass` เป็นจริงทุกช่อง (project command, clean install
และ project command หลังติดตั้งผ่านทั้งหมด) ช่องของ candidate และ previous ถึง `archived`
ส่วน arm ไม่มี harness ไม่มี lifecycle

| Arm | ค่าใช้จ่าย | เวลา | model requests | tool calls |
|---|---|---|---|---|
| Candidate | US$2.3035 | 587.8 s | 66 | 110 |
| v3.6.7 | US$2.1904 | 553.2 s | 63 | 106 |
| ไม่มี harness | US$1.1949 | 238.0 s | 39 | 66 |

- Candidate เทียบ v3.6.7: ค่าใช้จ่าย +5.2% เวลา +6.2% requests +4.8% tool calls +3.8% ที่ n=1
  อยู่ในช่วงความแปรปรวนปกติ (แถวรายงานด้านล่างขยับทั้งสองทิศ) แสดงว่าไม่เห็นการถดถอยที่ชัดเจน
  ไม่ได้แสดงว่าช้าลงหรือเร็วขึ้นแบบวัดได้
- Candidate เทียบไม่มี harness: ค่าใช้จ่าย 1.93 เท่า เวลา 2.47 เท่า requests 1.69 เท่า เป็น overhead
  ของ harness กับงานเล็ก อัตราส่วนเวลาสูงกว่า 1.98 เท่าของ smoke วันที่ 2026-10-21 ซึ่งเป็น candidate
  และตัวอย่างคนละชุด
- ใช้จ่ายจริง US$5.6888 จากเพดาน US$40 ทุกค่าวัดจาก result envelope ของ host ไม่มีค่าประมาณ

## ผลแยกตามงาน

ค่าใช้จ่ายเป็น US$ เวลาเป็นวินาทีตามนาฬิกาจริง oracle คือจำนวนที่ผ่าน/ทั้งหมด "เทียบ v3.6.7"
เปรียบเทียบ candidate กับเวอร์ชันก่อนหน้าเฉพาะงานนั้น

### 1. `owner-only-delete` (ขอบเขตการอนุญาต; matrix ระดับเสี่ยง high; oracle 9 เคส)

| Arm | ค่าใช้จ่าย | เวลา | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.3978 | 158.3 | 10 | 19 | 9/9 |
| v3.6.7 | 0.4382 | 92.6 | 15 | 24 | 9/9 |
| ไม่มี harness | 0.1719 | 24.9 | 5 | 8 | 9/9 |

เทียบ v3.6.7: ค่าใช้จ่าย −9.2% เวลา +71.0% requests 10 เทียบ 15 ถูกกว่าและใช้ request น้อยกว่า
แต่ช้ากว่า เมื่อรันหนึ่งรอบต่อช่อง อธิบายช่องว่างของเวลาด้วยการเปลี่ยนนี้ไม่ได้ สตรีมของ host
มีข้อความ repair เรื่อง undo ระดับ High ที่เพิ่มใหม่ (`scratch.undo is required for risk level High…`)
สองครั้ง แปลว่ากฎส่ง repair ให้ agent และ run ยัง `archived` ผ่าน 9/9 งานนี้กับ
`idempotent-refund` เป็นสองงานที่ matrix จัดว่าเสี่ยงสูง

### 2. `idempotent-refund` (เขียนซ้ำได้อย่างปลอดภัย; matrix ระดับเสี่ยง high; oracle 12 เคส)

| Arm | ค่าใช้จ่าย | เวลา | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.6626 | 237.1 | 17 | 32 | 12/12 |
| v3.6.7 | 0.6014 | 289.5 | 14 | 27 | 12/12 |
| ไม่มี harness | 0.4008 | 99.0 | 10 | 24 | 12/12 |

เทียบ v3.6.7: ค่าใช้จ่าย +10.2% เวลา −18.1% requests 17 เทียบ 14 ข้อความ repair เรื่อง undo
เดียวกันปรากฏสองครั้งในสตรีมของ host เป็นงานที่แพงที่สุดและนานที่สุดในทุก arm

### 3. `speed-up-search` (ปรับความเร็วโดยพฤติกรรมไม่เปลี่ยน; matrix ระดับเสี่ยง medium; oracle 11 เคส)

| Arm | ค่าใช้จ่าย | เวลา | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.4484 | 73.0 | 16 | 21 | 11/11 |
| v3.6.7 | 0.3510 | 60.0 | 10 | 18 | 11/11 |
| ไม่มี harness | 0.2481 | 54.7 | 11 | 13 | 11/11 |

เทียบ v3.6.7: ค่าใช้จ่าย +27.7% เวลา +21.8% requests 16 เทียบ 10 เป็นงานที่ candidate เพิ่มมากที่สุดใน
ห้างาน ไม่พบข้อความ repair เรื่อง undo ไม่ได้สืบหาสาเหตุ และการรันครั้งเดียวแยกจากความแปรปรวน
ไม่ได้ เป็นแถวแรกที่ควรรันซ้ำถ้าได้รับอนุญาตให้รันซ้ำ

### 4. `regression-fix-with-fixes` (regression ของ change ก่อนหน้า; matrix ระดับเสี่ยง low; oracle 10 เคส)

| Arm | ค่าใช้จ่าย | เวลา | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.4285 | 71.0 | 14 | 24 | 10/10 |
| v3.6.7 | 0.4271 | 61.5 | 14 | 23 | 10/10 |
| ไม่มี harness | 0.1851 | 27.6 | 7 | 12 | 10/10 |

เทียบ v3.6.7: ค่าใช้จ่าย +0.3% เวลา +15.5% requests เท่ากัน

### 5. `tiny-feature` (ฟีเจอร์ใหม่ขนาดเล็ก; matrix ระดับเสี่ยง low; oracle 8 เคส)

| Arm | ค่าใช้จ่าย | เวลา | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.3661 | 48.4 | 9 | 14 | 8/8 |
| v3.6.7 | 0.3726 | 49.7 | 10 | 14 | 8/8 |
| ไม่มี harness | 0.1890 | 31.8 | 6 | 9 | 8/8 |

เทียบ v3.6.7: ค่าใช้จ่าย −1.7% เวลา −2.5% requests 9 เทียบ 10

## ข้อจำกัด

- ห้าจาก 28 scenario แบบจ่ายเงิน ไม่ได้รันแถวความเสี่ยงสูงทั้งชุดและหลาย repository เป็น smoke
  ระดับข้อยกเว้น ไม่ใช่ checkpoint ครบทุก scenario ใน [RELEASING.md](../../RELEASING.md)
- ไม่มี scenario ใดในห้างานนี้ที่สร้างมาเพื่อทดสอบ work type ใหม่ (`data-fix`, `security`, `cicd`)
  หรือฟิลด์ที่เพิ่งบังคับ (`modelCard.evaluation`, guardrails/stop rules ของ `experimentDesign`
  และ `infraPlan.costDelta`) กฎใหม่ที่เห็นในหลักฐานมีเพียง repair เรื่อง undo ระดับ High/Critical
  ใน run ของ candidate สองงานที่ matrix จัดว่าเสี่ยงสูง (อีกสามงานที่จัดเป็น medium หรือ low ไม่พบ)
  ยังไม่ได้ทดสอบว่า work type ใหม่และคำตอบ `none:`/`unknown:` ใช้งานกับ agent จริงได้ดีหรือไม่
  `ml-eval-threshold` และ `security-hotfix` จะทดสอบเรื่องนี้ได้
- ระบุ repair เรื่อง undo จากข้อความในสตรีมของ host เท่านั้น ไม่ได้ตรวจข้อความที่ agent เขียนเพื่อแก้
  และจำนวนรอบ repair
- self-review ใน lab ที่ใช้แล้วทิ้งทำให้ค่าใช้จ่ายและความเป็นอิสระของ review ในโปรเจกต์จริงไม่ถูกสะท้อน
- n=1 ต่อช่อง ความต่างรายงานในทิศใดก็ตามไม่ใช่ผลที่เสถียร
- Claude Code เท่านั้น

## ข้อมูลดิบ

bundle รายการ run (scorecard, manifest, `integrity.json`, host stream, patch ที่ส่งมอบ) สคริปต์ตัว
ควบคุมแบบทีละ run `run-e2e.mjs` และ `driver.log` เก็บไว้นอก Git และนอก state ที่ใช้แล้วทิ้ง:

```text
~/.local/share/changeloop/benchmarks/2026-10-22-candidate-497ab55fb-vs-v3.6.7-vs-noharness.tar.gz
sha256 bcc8f02cb0314d509fcacbc84f2659bcf8a6d98984ade2b5c9aa8df323698761
```

archive มี 828 ไฟล์ รวม `integrity.json` รายการ run 15 ไฟล์ที่ผูกเนื้อหาของแต่ละ run manifest ของแต่ละ
run บันทึก source commit (`497ab55fb…` สำหรับ arm candidate และไม่มี harness, `a8d3d4b77…` สำหรับ
v3.6.7) `dirty: false` และ digest ของ seed ที่ตรึงไว้

## รันซ้ำ

```bash
# ด่านที่ไม่เสียเงินก่อน
npm run bench:openspec-native:sentinel
# หนึ่งช่อง: candidate แล้วเพิ่ม --arm baseline สำหรับ arm ไม่มี harness
ANTHROPIC_MODEL=claude-sonnet-5-5 node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario owner-only-delete --output-root <results>/candidate
```

arm ของรุ่นก่อนหน้ารันคำสั่งเดียวกันจาก worktree ของ `v3.6.7` หลัง `npm ci` การรันแบบจ่ายเงินต้องมี
สิทธิ์ชัดเจนจากผู้ใช้และเพดานค่าใช้จ่าย
