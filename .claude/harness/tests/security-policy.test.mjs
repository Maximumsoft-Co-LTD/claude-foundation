import assert from "node:assert/strict";
import test from "node:test";

import {
  SECURITY_TERMS, matchesSecurityTerm, materialSecurityTriggers
} from "../runtime/workflow/security-policy.mjs";

const matched = (intent) => SECURITY_TERMS.filter((term) => matchesSecurityTerm(intent, term));

test("business validation labels do not create a trust boundary", () => {
  const labels = [
    "untrusted-input", "type-confusion-validation-bypass", "schema-validation"
  ];
  for (const intent of [
    "Reject boolean seat counts in a workspace API",
    "Validate a checkout discount representation",
    "Show a form error for malformed profile fields"
  ]) assert.deepEqual(materialSecurityTriggers(labels, intent), []);
});

test("real security, data, and explicit custom risks remain material", () => {
  const validation = ["untrusted-input", "type-confusion-validation-bypass"];
  assert.deepEqual(materialSecurityTriggers(validation,
    "Prevent an authorization bypass in workspace validation"), validation);
  assert.deepEqual(materialSecurityTriggers(validation,
    "Block SQL injection from malformed filters"), validation);
  assert.deepEqual(materialSecurityTriggers(["manual-review"],
    "Migrate customer records"), ["manual-review"]);
});

test("Thai intents trigger every security family by substring", () => {
  const families = {
    "เพิ่มหน้าล็อกอินใหม่": "ล็อกอิน",
    "ผู้ใช้เข้าสู่ระบบด้วยอีเมล": "เข้าสู่ระบบ",
    "รีเซ็ตรหัสผ่านทางอีเมล": "รหัสผ่าน",
    "ตรวจสิทธิ์ก่อนแก้ไขโปรไฟล์": "สิทธิ์",
    "หมุนเวียนโทเคนเข้าถึงทุกชั่วโมง": "โทเคนเข้าถึง",
    "รองรับการชำระเงินด้วยบัตร": "ชำระเงิน",
    "คืนเงินเมื่อจ่ายเงินซ้ำ": "จ่ายเงิน",
    "ย้ายข้อมูลลูกค้าไปตารางใหม่": "ย้ายข้อมูล",
    "ไมเกรตสคีมาฐานข้อมูล": "ไมเกรต",
    "ลบข้อมูลบัญชีที่ปิดแล้ว": "ลบข้อมูล",
    "ซ่อนข้อมูลส่วนตัวในล็อก": "ข้อมูลส่วนตัว",
    "ปรับปรุงความปลอดภัยของ API": "ความปลอดภัย"
  };
  for (const [intent, term] of Object.entries(families))
    assert.ok(matched(intent).includes(term), `${intent} should match ${term}`);
  const validation = ["untrusted-input"];
  assert.deepEqual(materialSecurityTriggers(validation, "ป้องกันการข้ามสิทธิ์ในฟอร์ม"), validation);
});

test("Thai matching keeps generic words and English word boundaries quiet", () => {
  assert.deepEqual(matched("ลดการใช้โทเคนของโมเดลในงานสรุป"), []);
  assert.deepEqual(matched("ปรับสีปุ่มในหน้าแรก"), []);
  assert.deepEqual(matched("Improve accessibility guidance"), []);
});
