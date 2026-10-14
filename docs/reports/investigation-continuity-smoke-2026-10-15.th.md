# ผลทดสอบการส่งมอบ Investigation continuity — 2026-10-15

[English](investigation-continuity-smoke-2026-10-15.md)

งาน Investigate → Change ที่อนุมัติแล้วถึงสถานะ `archived` ก่อนการตรวจรอบนี้
ระบบเก็บ revision ของ requirements และที่มาจากบทสนทนา ถามประเด็นสำคัญที่ยัง
ไม่ชัดพร้อมแสดงงานอิสระ ผูก experiments กับ requirements และสร้างเอกสาร
native Change แบบละเอียดพร้อมตรวจ coverage ดูข้อตกลงและ ledger ที่เสร็จครบใน
[archived change](../../openspec/changes/archive/2026-10-14-investigation-requirement-continuity/tasks.md)
และพฤติกรรมหลักใน [WORKFLOW.md](../../WORKFLOW.md)

## ขอบเขตและการอนุมัติ

ผู้ใช้อนุมัติ commit, push และทดสอบ scenario พร้อมงบโมเดลรวมไม่เกิน US$200
เลือก paid lane `notes-api` หนึ่งรอบ โดยใช้เพดาน matrix ที่ต่ำกว่า คือ US$10,
30 นาที, 150 model requests และ 150 tool calls ไม่ได้ publish release หรือ
ทดสอบเปรียบเทียบกับ baseline

validator ที่แก้ท้ายงาน upstream ส่งมอบด้วย review waiver ที่ผู้ใช้อนุมัติ
หลังใช้ AI review ครบสองรอบ Tests ผ่าน แต่ส่วนนี้ยังไม่มี independent review สด
paid lab ใช้สิทธิ์ main-session self-review ตามข้อกำหนดของ consumer ชั่วคราว
ซึ่งไม่เปลี่ยนนโยบาย review ของ consumer จริง

## ผลที่ตรวจพบ

| การตรวจ | ผล |
|---|---|
| Regression tests ของ Investigate และ semantic draft | ผ่าน 130 tests |
| Authoritative suite หลัง Land | ผ่านครบ 225 suites ใช้ 8 workers, exit 0 |
| Documentation consistency | ผ่าน 139/139 assertions |
| Git whitespace check | ผ่าน |
| Deterministic sentinel | ผ่าน 12/12 scenario rows ไม่เสียค่าโมเดล |
| Paid `notes-api` | Strict pass, `completed`, lifecycle `archived` |
| Archived task ledger | ไม่มี task ค้าง |
| Hidden oracle ก่อน Land | ผ่าน 13/13 |
| Tests ของงานที่ส่งมอบ | ผ่าน 15/15 |
| Clean install | `npm install --ignore-scripts` ผ่านโดยใช้ cache ชั่วคราวแยกต่างหาก |
| Tests หลัง clean install | ผ่าน 15/15 |
| คุณภาพ product | ผ่าน 28 functions ไม่มี warning/failure; mean function coverage 86.21%, maximum CRAP 13.01 |
| เวลาถึง terminal boundary | 148.911 วินาที |
| ค่าโมเดลที่วัดได้จาก final host envelope | US$0.5192617 |
| Requests ที่พบใน stream | 12 ก่อน terminal และ 1 หลัง terminal |
| Host friction | hook blocks 0, permission prompts 0, tool error 1 |

Tool error หนึ่งครั้งไม่ขัดขวางการส่งมอบครบ paid run ใช้เส้นทาง
Change → Build → Prove → Land ปกติ ไม่ได้ทดสอบบทสนทนา Investigate หลายรอบ
ด้วย paid model การแก้ requirements การรักษาประวัติ คำถามสำคัญและไม่สำคัญ
ข้อมูลผิดรูป selective experiment staleness รายงานไทย และ compiled handoff
coverage ตรวจด้วย deterministic runtime/seam regressions

## Source และหลักฐาน

Run ID: `investigation-continuity-notes-api-20261015` รันวันที่
2026-10-14 เวลา 15:55–15:57 UTC หรือ 2026-10-15 ตามเวลา Asia/Bangkok
HEAD คือ `d157286b9b32c4374fcb94accf7c1a430c04228d` พร้อม dirty patch
จาก implementation ที่ Land แล้ว source-patch digest คือ
`sha256:a930e39f29cae09220e439f639487330e3d27ea1cde76123ba66d1f90d55733a`
ไฟล์ติดตั้งใหม่มีรายการใน installation manifest ผลนี้เป็น development smoke
ไม่ใช่ checkpoint ของ release source ที่ immutable

ลบ consumer ชั่วคราวหลังตรวจแล้ว ตรวจ checksum ครบ 41 ไฟล์ใน integrity manifest
และเก็บ raw evidence นอก Git และ disposable state ที่
`~/.local/share/changeloop/scenarios/investigation-continuity-notes-api-20261015.tar.gz`
SHA-256 `7990b7d1acfce0b4914b534b315ffb977da4bf6b6d6f8846e6c606b06e44af65`
มี source patch, installed manifest, lifecycle receipts/logs, host stream/result,
oracle, archived agreement และ scorecard

Paid run หนึ่งรอบให้หลักฐานระดับ smoke เท่านั้น ไม่ได้วัด repeat variance,
paired baseline, full paid portfolio หรือ production assurance ไม่พบ actual
model identity ใน scorecard และ timing dimensions ที่วัดไม่ได้คงสถานะ unavailable
