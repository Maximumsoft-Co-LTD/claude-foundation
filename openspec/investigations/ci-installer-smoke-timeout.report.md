<!-- change-loop:generated-investigation-report:v1 -->
# รายงานการสำรวจปัญหา: ci-installer-smoke-timeout

**สถานะ:** ข้อสรุปปัจจุบัน

อัปเดต: 2026-10-30T16:56:10.551Z · df01a9667ea5aba772c627edde1166885138b796af20e3325193f6ea45746196

## ปัญหา

ทำไม suite \`installer smoke\` ล้มบน CI (workflow-tests และ gate ของ release.yml) ตรงข้อ allowlist opt-out ท้าย suite ทั้งที่ผ่านในเครื่อง และ CI ผ่านบางรอบที่โค้ดเหมือนกัน

## ความต้องการและบริบทที่บันทึกไว้

**เป้าหมาย:** หาสาเหตุจริงของ installer smoke ที่ล้มสลับกันบน CI

**ผลลัพธ์ที่ต้องการ:** รู้กลไกและมีทางแก้ที่เลือกได้ โดยไม่แก้โค้ดระหว่าง investigate


### ผู้เกี่ยวข้อง

- maintainer ของ claude-foundation

### ขอบเขต

- install.sh
- .claude/tests/run-all.sh
- .claude/tests/harness/run-installer-tests.sh
- GitHub Actions workflow-tests และ release

### ช่องว่างของประวัติที่เข้าถึงไม่ได้

- log ของ CI อ่านได้เฉพาะผ่าน gh run view ผลย่อ ไม่ได้เก็บไฟล์ log ดิบ และไม่มีเวลาจริงของแต่ละ assertion เพราะ output ของ suite ถูก buffer แล้วพิมพ์ครั้งเดียว
- ไม่ได้ดูระยะเวลา installer smoke ของรอบที่ผ่าน เพราะ header ของระยะเวลาพิมพ์เฉพาะ suite ที่ล้ม

## ข้อสรุปปัจจุบัน

สาเหตุ: installer smoke ใช้เวลาเกินขีด 300 วินาทีที่ run-all.sh ตั้งไว้เป็นค่าปริยายต่อ suite บน runner ของ CI ที่รัน 24 suite ขนาน watchdog จึงฆ่า install.sh ที่กำลังรันอยู่ (kill\_tree ฆ่าลูกก่อนแม่) ทำให้ตายเงียบและ assertion ท้ายสุด (ข้อ allowlist opt-out) ล้ม ส่วน suite ยังพิมพ์สรุปทันก่อนถูกฆ่า ข้อ opt-out ไม่เกี่ยวกับโค้ดของ flag และปัญหานี้มีมาก่อนงาน approval page ที่ baseline e88c34e44 topology planning ก็ถูกฆ่าที่ 600 วินาทีในรอบ release ซึ่งเป็นกลไกเดียวกัน ทางแก้ที่เป็นไปได้ (ยังไม่ได้ทำ): (ก) ใส่ installer smoke ในรายการ 600 วินาทีของ run-all.sh (ข) ลดจำนวนงานขนานบน CI ด้วย FOUNDATION\_TEST\_JOBS (ค) ทำให้ผลล้มจาก timeout ชัดเจน เช่นเมื่อมี marker timeout ให้รายงานเป็นล้มด้วยสาเหตุ timeout แทน assertion ที่ทำให้เข้าใจผิด (ง) ลดเวลาของ installer suite เอง ข้อจำกัด: ไม่ได้ทำซ้ำเวลา CI ในเครื่อง สรุปจากหลักฐานใน log ของ CI และโค้ดของ watchdog เท่านั้น ไม่ได้ตรวจระยะเวลาของรอบที่ผ่าน

## ข้อเสนอแนะและเหตุผล

ให้ run-all.sh ไม่ฆ่า installer smoke ที่ 300 วินาทีบน CI โดยใส่ในรายการ timeout 600 วินาที และให้ suite ที่ถูก watchdog ฆ่ารายงานเป็นล้มเพราะ timeout อย่างชัดเจน

## ข้อเท็จจริงที่มีแหล่งอ้างอิง

- **output-ends-after-plan:** assert\_cmd\_zero พิมพ์ tail 40 บรรทัดของ stdout+stderr ของคำสั่งที่ล้ม ใน log ของ CI output ของ install.sh จบที่บรรทัดแผน (AGENTS.md) โดยไม่มีข้อความ error และไม่มี \`INFO upgrade-context\` ที่เครื่องผมพิมพ์ต่อจากแผน แปลว่า install.sh ตายเงียบหลังพิมพ์แผน ก่อนถึงขั้น update-advisory ([.claude/tests/lib/assert.sh](<../../.claude/tests/lib/assert.sh>), [install.sh](<../../install.sh>))
- **opt-out-code-after-window:** โค้ดที่เฉพาะกับ --no-permission-allowlist (jq del(.permissions.allow)) อยู่หลังขั้น update-advisory ซึ่งอยู่หลังจุดที่ตาย ดังนั้นการตายไม่ได้เกิดในโค้ด opt-out ข้อ opt-out ล้มเพราะเป็น install ครั้งสุดท้ายของ suite ไม่ใช่เพราะ flag ([install.sh](<../../install.sh>), [.claude/tests/harness/run-installer-tests.sh](<../../.claude/tests/harness/run-installer-tests.sh>))
- **ci-reports-300s:** ใน log ของรอบที่ installer smoke ล้ม (workflow-tests รัน 41075327217 และ 41029941609, release รัน 41075351226) มี header \`── tail of installer smoke (300s) ──\` และบรรทัด \`suite exceeded 300s and was terminated\` ใน output ของ suite เดียวกัน ([.claude/tests/run-all.sh](<../../.claude/tests/run-all.sh>), [.github/workflows/workflow-tests.yml](<../../.github/workflows/workflow-tests.yml>))
- **watchdog-300s-kill-tree:** run-all.sh ให้ทุก suite มี watchdog 300 วินาทีโดยปริยาย (600 วินาทีเฉพาะ topology planning, pull request delivery, proof loop end to end, apply conflict, concurrent repositories seam) เมื่อครบเวลา kill\_tree ฆ่าลูกทุกตัวก่อนแล้วจึงฆ่าตัวแม่ด้วย SIGTERM \`installer smoke\` ไม่อยู่ในรายการ 600 วินาที ([.claude/tests/run-all.sh](<../../.claude/tests/run-all.sh>))
- **last-assertions-fail:** assertion ที่ล้มเป็นสองถึงสามข้อท้ายสุดของ suite (ข้อ allowlist opt-out ก่อน finish ที่บรรทัด 1073) สอดคล้องกับการที่ kill\_tree ฆ่า install.sh ซึ่งเป็นลูกก่อน ส่วน shell ของ suite รันต่ออีกเสี้ยววินาทีจนรัน assertion ที่เหลือและพิมพ์สรุป \`installer: N/322 FAILED\` ทันก่อนถูกฆ่า ([.claude/tests/harness/run-installer-tests.sh](<../../.claude/tests/harness/run-installer-tests.sh>), [.claude/tests/run-all.sh](<../../.claude/tests/run-all.sh>))
- **same-code-different-result:** CI ที่ commit 6005e473e ผ่านและที่ e88c34e44 ล้ม ต่างกันเฉพาะไฟล์รายงานใน docs/reports โค้ดเหมือนกัน และ e88c34e44 ล้มด้วย installer smoke ก่อนงานของผม ผลจึงขึ้นกับเวลาของ runner ไม่ใช่โค้ด ([.github/workflows/workflow-tests.yml](<../../.github/workflows/workflow-tests.yml>))
- **local-margin:** installer smoke รันเดี่ยวในเครื่องใช้ 108 วินาที ใต้ขีด 300 วินาทีราว 2.8 เท่า บน CI ที่รัน 24 suite ขนานบน runner 2 ถึง 4 แกน ใช้เวลาไม่เกิน 300 วินาทีในบางรอบและเกินในบางรอบ ([.claude/tests/run-all.sh](<../../.claude/tests/run-all.sh>))
- **not-reproduced-locally:** รัน installer suite 12 ชุดพร้อมกันในเครื่องพร้อม xtrace ผ่านครบ 322/322 ทุกชุด จำลอง HOME สะอาด CI=true และ jq 1.7.1 ผ่านหมด และไม่มี suite ใดเขียน .claude/settings.json ของซอร์สจริง (ทุกที่เขียนลง temp target) จึงไม่พบ race บนไฟล์ settings ([.claude/tests/harness/run-installer-tests.sh](<../../.claude/tests/harness/run-installer-tests.sh>))
- **release-gate-also-times-out:** ในรอบ release ที่ล้ม (41075351226) \`harness contracts (topology planning)\` ก็ถูก watchdog 600 วินาทีฆ่าเช่นกัน และ run-all.sh มีคอมเมนต์เองว่า suite เหล่านี้อาจเกินห้านาทีบน macOS CI runner ([.claude/tests/run-all.sh](<../../.claude/tests/run-all.sh>))

## สมมติฐานและหลักฐาน

- **h-watchdog-kills-install — มีหลักฐานสนับสนุน:** installer smoke ใช้เวลาครบ 300 วินาทีบน CI ที่โหลดสูง watchdog ของ run-all.sh ฆ่า install.sh ที่กำลังรันก่อน จึงตายเงียบและ assertion ท้ายสุดล้ม; หลักฐาน: output-ends-after-plan, ci-reports-300s, watchdog-300s-kill-tree, last-assertions-fail, same-code-different-result, local-margin
- **h-opt-out-code-bug — มีหลักฐานหักล้าง:** โค้ด --no-permission-allowlist ใน install.sh มีบั๊กที่ทำให้ติดตั้งล้ม; หลักฐาน: opt-out-code-after-window, not-reproduced-locally
- **h-settings-race — มีหลักฐานหักล้าง:** suite อื่นแก้ .claude/settings.json ของซอร์สระหว่างที่ installer อ่าน; หลักฐาน: not-reproduced-locally
- **h-jq-version — มีหลักฐานหักล้าง:** jq รุ่นเก่าบน CI (1.7.x) ทำให้ jq program ของ opt-out ล้ม; หลักฐาน: not-reproduced-locally, opt-out-code-after-window

## การตัดสินใจ

- **which-fix — ตัดสินใจแล้ว:** จะแก้การที่ watchdog ของ run-all.sh ฆ่า installer smoke บน CI อย่างไร
  ตัวเลือก: ก: เพิ่ม installer smoke ในรายการที่ได้ timeout 600 วินาที (แก้บรรทัดเดียวใน run-all.sh) / ข: ลดจำนวนงานขนานบน CI ด้วย FOUNDATION\_TEST\_JOBS ใน workflow-tests.yml และ release.yml / ค: ทำให้การล้มจาก timeout ชัดเจน ให้ run-all.sh รายงานว่า suite ล้มเพราะ timeout แทนปล่อย assertion ท้ายสุดที่ทำให้เข้าใจผิด / ง: ลดเวลาของ installer suite เอง (เช่นลดจำนวนการติดตั้งที่คัดลอกไฟล์ทั้งชุดซ้ำ); ข้อเสนอแนะและเหตุผล: ก ร่วมกับ ค; หลักฐาน: watchdog-300s-kill-tree, last-assertions-fail, local-margin, release-gate-also-times-out

## สิ่งที่ยังไม่รู้และงานที่เหลือ

ยังไม่ได้บันทึก

## แหล่งอ้างอิง

- [.claude/tests/harness/run-installer-tests.sh](<../../.claude/tests/harness/run-installer-tests.sh>)
- [.claude/tests/lib/assert.sh](<../../.claude/tests/lib/assert.sh>)
- [.claude/tests/run-all.sh](<../../.claude/tests/run-all.sh>)
- [.github/workflows/workflow-tests.yml](<../../.github/workflows/workflow-tests.yml>)
- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.th.md](<../../docs/reports/scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/scenario-smoke-candidate-8913c2da9-2026-10-30.th.md](<../../docs/reports/scenario-smoke-candidate-8913c2da9-2026-10-30.th.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [install.sh](<../../install.sh>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [openspec/specs/skill-guidance/spec.md](<../specs/skill-guidance/spec.md>)
- [website/docs/src/content/docs/th/approval.md](<../../website/docs/src/content/docs/th/approval.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)

## แหล่งที่ค้นพบแต่ยังไม่มีข้อเท็จจริงอ้างอิง (hash แล้ว ยังไม่ได้อ่าน)

- [docs/reports/agent-harness-simplification-plan-2026-09-03.md](<../../docs/reports/agent-harness-simplification-plan-2026-09-03.md>)
- [openspec/specs/skill-guidance/spec.md](<../specs/skill-guidance/spec.md>)
- [docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md](<../../docs/reports/weekly-review-feedback-remediation-plan-2026-09-11.md>)
- [website/docs/src/content/docs/th/approval.md](<../../website/docs/src/content/docs/th/approval.md>)
- [docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md](<../../docs/reports/concurrent-change-review-efficiency-plan-2026-09-08.md>)
- [openspec/specs/change/spec.md](<../specs/change/spec.md>)
- [website/docs/src/content/docs/th/loop/change.md](<../../website/docs/src/content/docs/th/loop/change.md>)
- [docs/reports/harness-core-path-simplification-plan-2026-09-30.md](<../../docs/reports/harness-core-path-simplification-plan-2026-09-30.md>)
- [website/docs/src/content/docs/th/artifacts.md](<../../website/docs/src/content/docs/th/artifacts.md>)
- [website/docs/src/content/docs/th/foundation-config.md](<../../website/docs/src/content/docs/th/foundation-config.md>)
- [docs/reports/development-roadmap-2026-09-05.md](<../../docs/reports/development-roadmap-2026-09-05.md>)
- [docs/reports/scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.th.md](<../../docs/reports/scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.th.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/proposal.md](<../changes/archive/2026-10-16-complete-change-packets/proposal.md>)
- [website/docs/src/content/docs/th/cli.md](<../../website/docs/src/content/docs/th/cli.md>)
- [docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html](<../../docs/reports/harness-report-make-foundation-agents-surface-an-available-harness-update-durin.html>)
- [docs/reports/harness-behavior-plan-2026-09-05.md](<../../docs/reports/harness-behavior-plan-2026-09-05.md>)
- [docs/reports/consumer-quality-framework-plan.md](<../../docs/reports/consumer-quality-framework-plan.md>)
- [docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md](<../../docs/reports/scenario-benchmark-no-harness-2026-10-08.th.md>)
- [docs/reports/scenario-pstack-gates-2026-10-15.th.md](<../../docs/reports/scenario-pstack-gates-2026-10-15.th.md>)
- [docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html](<../../docs/reports/harness-report-aggregate-semantic-validation-failures-and-make-unavailable-host.html>)
- [docs/reports/scenario-smoke-candidate-8913c2da9-2026-10-30.th.md](<../../docs/reports/scenario-smoke-candidate-8913c2da9-2026-10-30.th.md>)
- [openspec/changes/archive/2026-10-16-complete-change-packets/design.md](<../changes/archive/2026-10-16-complete-change-packets/design.md>)
- [docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html](<../../docs/reports/harness-report-make-harness-feedback-version-aware-upgrade-safe-actionable-and-.html>)
- [docs/reports/harness-report-maximize-harness-guidance-and-automation.html](<../../docs/reports/harness-report-maximize-harness-guidance-and-automation.html>)

## ขั้นตอนถัดไป

พร้อมเสนอ Change โดยยังต้องมีเจตนาของผู้ใช้

The investigation is source-grounded and has a terminal conclusion.

คำสั่งที่ agent ใช้ทำต่อ:

```text
claude-foundation investigate openspec/investigations/ci-installer-smoke-timeout.json
```

