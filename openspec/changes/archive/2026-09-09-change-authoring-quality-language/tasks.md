# Tasks

> This is the sole implementation ledger.

- [x] **T001** ปรับคำสั่ง Change และ workflow ให้มีเกณฑ์รายละเอียด ภาษา และการตรวจ packet พร้อมเอกสารสาธารณะสองภาษาและ regression ของ instruction contract [key:authoring-guidance] [kind:implementation] [paths:.claude/commands/change.md,.claude/skills/change/references/workflow.md,.claude/tests/harness/run-user-guidance-tests.sh,WORKFLOW.md,README.md,README.th.md] [claims:complete-change-authoring-code-spec,complete-change-authoring-compiler-change,user-language-change-prose-change,user-language-change-prose] — verify: `rtk test bash .claude/tests/harness/run-user-guidance-tests.sh`
- [x] **T002** เพิ่มเพดานเฉพาะ change.md จาก 175 เป็น 200 คำตามที่ผู้ใช้อนุญาต พร้อมบันทึกเหตุผล [key:expand-change-command-budget] [paths:.claude/tests/harness/run-context-budget-tests.sh] [claims:change-command-budget] — verify: `rtk test bash .claude/tests/harness/run-context-budget-tests.sh`
