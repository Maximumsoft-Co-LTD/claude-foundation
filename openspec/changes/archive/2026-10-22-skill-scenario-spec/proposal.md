# Change: รวมยอดการโหลด skill ต่อ scenario และลบ spec ที่ขัดกับโค้ด

- **Change:** `skill-scenario-spec` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-22

## เหตุผล

ผลทดสอบแสดงว่า agent แทบไม่เรียก skill (1 จาก 319 run ที่วัดได้) แต่ aggregate ไม่เคยสรุปยอดนี้ให้ผู้ดูแล และ spec ของ work-type-catalog ยังสัญญาว่า Build จะแนะนำ skill ทั้งที่ runtime ถอดออกแล้ว change นี้เพิ่มยอดการโหลด skill ใน aggregate และลบข้อที่ขัดกับโค้ด โดยไม่เพิ่ม gate ใหม่ให้ผู้ใช้หรือ agent

## ขอบเขต

- เพิ่ม skillToolCalls, skillRuns, skillsLoaded ใน aggregate ของ lab
- ลบ requirement "Each work type routes to its skills" ออกจาก work-type-catalog
- ไม่เพิ่ม verify หรือ polish task, capability หรือ provider ใหม่
- ไม่เปลี่ยนวิธีที่ agent เลือก skill

- **In scope:** ผู้ดูแลเห็นว่า skill ถูกโหลดกี่ run ต่อ scenario จากผล aggregate โดยไม่ต้องเปิด scorecard ทีละใบ; spec ของ work-type-catalog ไม่สัญญาสิ่งที่ runtime ถอดออกแล้ว
- **Out of scope:** edits outside `.claude/tests/bench/openspec-native/aggregate.mjs`, `.claude/tests/bench/tests/openspec-native-aggregate.test.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| build-skill-routing | aggregate-skill-usage | T001 |
| work-type-catalog | Each work type routes to its skills | T002 |

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| aggregate-skill-usage | ผสมวัดได้และวัดไม่ได้ | success | T001 | test: `.claude/tests/bench/openspec-native/aggregate.mjs`, `.claude/tests/bench/tests/openspec-native-aggregate.test.mjs` | — |
|  | วัดได้แต่ไม่มีใครโหลด | boundary | T001 |  |  |
|  | ไม่มี host stream เลย | boundary | T001 |  |  |
| Each work type routes to its skills | EDIT ไม่ระบุ skill | boundary | T002 | test: `.claude/harness/tests/advance-runtime.test.mjs` | — |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for aggregate-skill-usage, remove-skill-routing-catalog.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | F1-empty-diff-aggregate-mixed: Scenario 'ผสมวัดได้และวัดไม่ได้' (three runs in one scenario: one measured with 0 calls, one measured with 2 calls, one with no host stream) isn't covered by anything in the dispatched diff. reviewDiff.files is empty and the root repository has no changed paths, so I couldn't confirm any of the expected results: skillToolCalls=2, skillRuns=1, skillsLoaded one per skill, and measurements.skillUsage measured 2 / unavailable 1. Test evidence is also marked 'missing'. I couldn't tell whether the implementation is absent or just wasn't dispatched. (contract/specs/build-skill-routing/spec.md) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F2-empty-diff-aggregate-zero: Scenario 'วัดได้แต่ไม่มีใครโหลด' (every run measured, skillToolCalls=0) isn't covered by anything in the dispatched diff. With no hunks I couldn't confirm that skillRuns comes out as 0 rather than null when every run was measured and none loaded a skill. Test evidence is marked 'missing'. (contract/specs/build-skill-routing/spec.md) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
| 1 | F3-empty-diff-aggregate-null: Scenario 'ไม่มี host stream เลย' (no run has a measurable skillUsage) isn't covered by anything in the dispatched diff. With no hunks I couldn't confirm that skillRuns and skillsLoaded come out as null rather than 0. Test evidence is marked 'missing'. (contract/specs/build-skill-routing/spec.md) | major | ยืนยันการแก้ในรอบ 2 | claude-opus |
