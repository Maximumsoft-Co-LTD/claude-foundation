# Tasks

> This is the sole implementation ledger.

- [x] **T001** aggregate รวมยอด skill ต่อ scenario พร้อม test [key:add-skill-rollup] [kind:implementation] [paths:.claude/tests/bench/openspec-native/aggregate.mjs,.claude/tests/bench/tests/openspec-native-aggregate.test.mjs] [claims:aggregate-skill-usage-aggregate,aggregate-skill-usage-aggregate-2,aggregate-skill-usage-aggregate-3] — verify: `node --test .claude/tests/bench/tests/openspec-native-aggregate.test.mjs`
- [x] **T002** test ของ runtime ยืนยันว่า EDIT ไม่ระบุ skill ก่อนถอด requirement ที่ขัดกัน [key:confirm-no-skill-routing] [kind:implementation] [paths:.claude/harness/tests/advance-runtime.test.mjs] [claims:remove-skill-routing-catalog] — verify: `node --test .claude/harness/tests/advance-runtime.test.mjs`
