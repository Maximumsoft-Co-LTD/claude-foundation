# Change: ให้ agent ประกาศความเสี่ยงแบบ typed จาก template และกัน benchmark ที่วัดแล้ว noise ไม่ให้วน repair

- **Change:** `agent-typed-template-benchmark-noise-repair` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-15 · **Status:** `claude-foundation changes`

## Why

paid run 24 รอบพบว่า agent ไม่เคยประกาศ riskSignals, access tag หรือ fixes เอง เพราะ change start --template ซึ่งเป็น schema หลักที่ agent อ่าน ไม่มี field เหล่านี้เลย งานเรื่องสิทธิ์จึงถูกจัดเป็น rapid ความเสี่ยงต่ำ และ gate ใหม่ไม่ทำงาน นอกจากนี้ benchmark ที่วัดแล้ว noise อาจพา agent วน repair จนต้องถาม user ผู้ใช้เลือกแนวทางปรับคำแนะนำแทนการให้ harness อ่าน prose

## Capabilities

| Capability | Requirements | Tasks |
|---|---|---|
| change | Draft template teaches typed risk declarations | T001 |
| evidence-quality | Benchmark regression is confirmed before repair | T002 |

## Scope

- **In scope:** agent ที่อ่านเฉพาะ template รู้ว่างานเรื่องสิทธิ์ เงิน ความเร็ว และการแก้บั๊กของ change ที่ archive แล้ว ต้องประกาศอะไร; noise ครั้งเดียวไม่ทำให้ agent ได้ REPAIR ที่แก้ไม่ได้ และ receipt เก็บทั้งการวัดแรกและการวัดยืนยัน
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/change-atomic-start.test.mjs`, `.claude/harness/runtime/evidence/benchmark-runtime.mjs`, `.claude/harness/tests/benchmark-evidence.test.mjs`, `.claude/harness/EVIDENCE.md`; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| template-risk-guidance › change-start-template | happy | T001 | .claude/harness/tests/change-atomic-start.test.mjs |
| template-risk-guidance › change-start-template-2 | happy | T001 | .claude/harness/tests/change-atomic-start.test.mjs |
| template-risk-guidance › change-start-template-3 | edge | T001 | .claude/harness/tests/change-atomic-start.test.mjs |
| benchmark-confirms-regression › prove-provider | failure | T002 | .claude/harness/tests/benchmark-evidence.test.mjs |
| benchmark-confirms-regression › prove-provider-2 | edge | T002 | .claude/harness/tests/benchmark-evidence.test.mjs |
| benchmark-confirms-regression › prove-provider-3 | happy | T002 | .claude/harness/tests/benchmark-evidence.test.mjs |

## Definition of done

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## Constraints

- ไม่สแกน prose เพื่อตัดสินความเสี่ยง; คำแนะนำอยู่ใน template เท่านั้น
- ไม่เปลี่ยน protocol.json, semanticDraftSchema 4 หรือ runtime API pin

## Non-goals

- ไม่ให้ harness อ่าน requirement prose เพื่อเดา riskSignals
- ไม่เปลี่ยนชื่อหรือความหมายของ field ที่มีอยู่

## Derived by harness

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.
