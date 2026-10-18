# Change: แก้ preview ที่ถูกปฏิเสธก่อน Build และ package ที่ล้มเมื่อ evidence ผิด

- **Change:** `preview-build-package-evidence` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-18

## สรุป

แก้ 2 bug ที่พบตอนทดสอบ Scratch Router ในโปรเจกต์จริง (preview ถูกปฏิเสธก่อน Build และ package ล้มเมื่อ evidence ผิด) และปรับ package ให้ผู้อนุมัติเห็นงานจริง: เนื้อหาของ agreement ใต้ artifact, ผลและไฟล์ของ preview, ป้าย proof หลัง Land, provider แบบ preview-only และให้ router ดู path ที่ task แตะ

## เหตุผล

preview เป็นฟีเจอร์ที่ใช้ไม่ได้เลยในโปรเจกต์จริง และ package ซึ่งควรเป็นตัวช่วยอ่านกลับล้มทั้งคำสั่งเพราะ config ที่ไม่เกี่ยวกับการอนุมัติ ผู้อนุมัติจึงไม่เห็นงานก่อนอนุมัติตามที่ออกแบบไว้

## ขอบเขต

- **In scope:** preview gate และ provider แบบ previewOnly พร้อม previewArtifact; package ที่ทนต่อ evidence ผิด แสดงเนื้อหา agreement ผล preview และป้าย proof หลัง Land; ตาราง failure ที่กรองตาม artifact; router อนุมาน signal จาก path ที่ task แตะ
- **Non-goals:** ไม่เปลี่ยนสัญญา preview receipt นอกจากเพิ่ม field artifact; path signal ไม่เปลี่ยน discovery coverage หรือ review tier

## Non-goals

- ไม่เปลี่ยนเนื้อหาของ package
- ไม่เปลี่ยนสัญญา preview receipt

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| preview-stage | preview-before-build | T001 |
| approval-package | package-tolerates-evidence | T002 |

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected
- **Fixes:** approval-package-route-change

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| preview-before-build | workspace เป็น target | success | T001 | test: `.claude/harness/tests/preview-runtime.test.mjs` | — |
|  | ไม่มี workspace | boundary | T001 |  |  |
|  | workspace mode อื่นที่ชี้ root | boundary | T001 |  |  |
|  | มี sandbox แล้ว | failure | T001 |  |  |
|  | สถานะ building | failure | T001 |  |  |
| package-tolerates-evidence | evidence.yaml เป็น JSON ที่เสีย | boundary | T002 | test: `.claude/harness/tests/approval-package.test.mjs` | — |
|  | change ที่ไม่มีอยู่ | boundary | T002 |  |  |
|  | provider ไม่มี adapter | failure | T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (8).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | preview-before-build, package-tolerates-evidence |  |  |

## Amendment discovery coverage

Reason: ผู้ใช้สั่งแก้ข้อจำกัดที่พบจากการทดสอบจริง: ป้าย proof หลัง archive, provider แบบ preview-only, ลิงก์ prototype, ตาราง failure ที่ไม่ตรง artifact และให้ router ดู path ที่แตะ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| input-boundary | covered | preview-artifact-link, router-path-signals | none | none |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.

## Appendix: Amendment history

- Revision 1 (2026-10-18): ผู้ใช้ขอให้ approval package แสดงเนื้อหาจริงของ agreement ไม่ใช่แค่ชื่อ artifact หลังทดสอบงานถอนเงินแล้วพบว่าผู้อนุมัติยังต้องเปิด packet เอง
- Revision 2 (2026-10-18): ทดสอบงานถอนเงินแล้ว preview race-check แสดงว่าโค้ดแบบไม่มี idempotency จ่าย 160 จากยอด 100 แต่ package แสดงแค่ป้าย preview ผู้อนุมัติจึงไม่เห็นผลทดลอง
- Revision 3 (2026-10-18): ผู้ใช้สั่งแก้ข้อจำกัดที่พบจากการทดสอบจริง: ป้าย proof หลัง archive, provider แบบ preview-only, ลิงก์ prototype, ตาราง failure ที่ไม่ตรง artifact และให้ router ดู path ที่แตะ
- Revision 4 (2026-10-18): สรุปและขอบเขตเดิมพูดถึงแค่ 2 bug และมี non-goal 'ไม่เปลี่ยนเนื้อหาของ package' ที่ขัดกับ requirement ที่ผู้ใช้สั่งเพิ่มภายหลัง

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-telemetry-blocked-flag: Trapped evidence and receipt failures go through `die()`, which calls `markBlocked()` and sets `operationBlocked`/`operationBlocker` even though the exception is caught. A `package` run that exits 0 with a warning can therefore be recorded in telemetry as blocked. Non-blocking, since the exit code and output are correct, but the blocked signal may be misleading. (root/.claude/harness/runtime/workflow/approval-package.mjs:196) | minor | แก้แล้วในรอบ 2 | claude-opus |
| 2 | f-notice-suggestions-not-omitted: When evidence can't be read, the notice says "providers, proof labels, and suggestions are omitted". But `previewSuggestions(route, providers, id)` still runs with `providers = []` (line 311). For a High or Critical change the page therefore still shows a 'Suggested previews' section, and each row says "no provider yet; declare a provider with capability X in evidence.yaml". That advice is misleading when a provider is declared but the file failed to parse or validate. Either leave suggestions out when evidence fails, or reword the notice and the per-row text. Non-blocking: exit code, file write, and the warning itself are all correct. (root/.claude/harness/runtime/workflow/approval-package.mjs:285) | minor | แก้แล้วในรอบ 3 | claude-opus |
| 3 | f-preview-only-skips-identity-validation: previewOnly providers are filtered out before `validateConfiguredProvider` runs, so they also skip `validateProviderIdentity`. That check is the instance-id regex `/^[a-z0-9][a-z0-9._-]*$/`, the object-type check, the known-capability check, and the adapter check. preview-runtime then uses the raw provider key in file paths. `previewReceiptPath` does `join(previewsDir, id, "receipts", `${provider}.json`)`, and the artifact copy goes to `join(base, "artifacts", `${provider}-...`)`. A previewOnly key such as `../../../receipts/<id>/test` with a command passes evidence(). Then `preview <id> --provider ../../../receipts/<id>/test` writes a preview receipt over `.foundation/receipts/<id>/test.json` in the proof receipt store, destroying the real Prove receipt. Before this change every declared provider had to match the regex, so it could not contain path separators. The same function now containment-checks `previewArtifact`, which makes this gap inconsistent. Fix: call `validateProviderIdentity`, or at least the id regex and the object check, for previewOnly entries too. Add a test that a previewOnly provider named with `/` or `..` is refused before anything runs. (root/.claude/harness/runtime/evidence/evidence-contract.mjs:1027) | major | ยืนยันการแก้ในรอบ 4 | claude-opus |
| 3 | f-evidence-doc-adapter-not-enforced: The docs say a previewOnly provider is exempt from wiring rules "beyond having an adapter and a command". The code never checks the adapter for previewOnly providers: evidence-contract skips all validation and preview-runtime checks only `command`. The test fixture `broken: { previewOnly: true, capability: "browser" }` has no adapter, and it is refused only for the missing command. Either enforce the adapter (see f-preview-only-skips-identity-validation) or fix the docs. (root/.claude/harness/EVIDENCE.md:413) | minor | แก้แล้วในรอบ 4 | claude-opus |
| 3 | f-sandbox-detect-no-realpath: The sandbox check compares `resolve(workspacePath)` with `resolve(root)`, and `resolve` does not follow symlinks. A legacy workspace with no mode whose recorded path is a symlinked alias of the root is treated as a Build sandbox and refused. On macOS that happens with `/var` vs `/private/var` or `/tmp` vs `/private/tmp`. The failure is safe (preview refused, nothing breaks), but the scenario 'workspace mode อื่นที่ชี้ root' (another workspace mode pointing at root) can fail depending on how the path was recorded. Consider comparing realpaths when both exist. (root/.claude/harness/runtime/workflow/preview-runtime.mjs:33) | minor | แก้แล้วในรอบ 4 | claude-opus |
| 4 | f-preview-artifact-symlink-or-dir: The previewArtifact containment check is purely lexical: it resolves the path and checks the relative path. It does not follow symlinks. copyFileSync at line 71 does follow them. So a scratch/prototype.html that is a symlink, either copied from the target or created by the command, gets its outside target copied into .foundation/previews/<id>/artifacts. That contradicts the rule that previewArtifact must not leave the preview workspace. The command is user-declared, so the impact is low. Separately, previewArtifact '.' or any directory passes the check. Then copyFileSync throws EISDIR after the command has already run, so no receipt is written. Fix: realpath the artifact after the run and re-check containment, and require statSync(...).isFile() before copying. (root/.claude/harness/runtime/workflow/preview-runtime.mjs:54) | minor | ยังเปิดอยู่ | claude-opus |
