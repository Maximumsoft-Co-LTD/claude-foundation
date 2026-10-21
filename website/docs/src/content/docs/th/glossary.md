---
title: อภิธานศัพท์
description: ความหมายของคำที่ Change Loop ใช้ในภาษาธรรมดา พร้อม identifier ที่จะเห็นจริงและหน้าที่คำนั้นสำคัญ
---

<!-- docs-audience: users -->
**ผู้อ่าน:** ผู้ใช้โปรเจกต์ เปิดหน้านี้เมื่อหน้าอื่นหรือ agent ใช้คำที่ยังไม่คุ้น แต่ละรายการบอกความหมายแบบภาษาทั่วไปก่อน แล้วจึงบอก identifier ที่จะเห็นใน output และไฟล์

คำจัดกลุ่มตามลำดับที่คุณจะเจอ: ตัวงาน การตรวจสอบ การตัดสินใจ และกลไก

## ตัวงาน

| คำ | ความหมายแบบภาษาคน | Identifier | เจอที่ไหน |
|---|---|---|---|
| **Change** | งานที่ขอหนึ่งชิ้น ตามตั้งแต่ไอเดียจนถึงโค้ดที่ส่งมอบแล้ว ภายใต้ ID เดียว | `change`, `/change <intent>` | [หนึ่ง change ตั้งแต่ต้นจนจบ](/docs/th/journey/) |
| **Agreement** (spec) | คำอธิบายที่เขียนและอนุมัติแล้วว่า change ต้องทำอะไร เป็น scenario ที่อ่านเข้าใจ โค้ดถูกตัดสินเทียบกับสิ่งนี้ | OpenSpec change; `proposal`, `specs`, `tasks.md` | [Change](/docs/th/loop/change/) |
| **Amendment** | การแก้ agreement ที่อนุมัติแล้ว เมื่อคุณหรือ agent รู้อะไรใหม่ระหว่าง build ใช้ change ID เดิม และทำซ้ำเฉพาะ proof ที่ได้รับผลกระทบ | amendment, `/change` ระหว่าง Build | [Change](/docs/th/loop/change/) |
| **Rapid / standard** | ระดับพิธีการของ change: rapid สำหรับงานเล็กที่แยกอิสระและเสี่ยงต่ำ standard สำหรับที่เหลือ | `foundation-rapid`, `foundation-standard` | [Change](/docs/th/loop/change/) |
| **Sandbox** (worktree) | สำเนาที่แยกขาดของโปรเจกต์ที่ใช้ทำงาน เพื่อให้ main checkout ของคุณไม่ถูกแตะจนกว่าจะ Land | sandbox, workspace ใน `.foundation/` | [Build](/docs/th/loop/build/) |
| **Advance** (coordinator) | คำสั่งเดียวที่ทำต่อได้ ซึ่ง agent ใช้ผลัก change ไปข้างหน้า มัน reuse งานที่ใช้ได้ หยุดเฉพาะที่ต้องตัดสินใจจริง และบอกวิธี resume ที่แน่นอน | `advance <change> --through build\|proven\|archived` | [CLI reference](/docs/th/cli/) |
| **Harness** | โปรแกรม deterministic ที่เป็นเจ้าของกฎ: isolation, การรัน check, การบันทึกผล, budget และ Land มันไม่ใช่ AI และไม่เดา | `claude-foundation`, `.claude/harness/` | [ติดตั้ง](/docs/th/install/) |

## การตรวจสอบ

| คำ | ความหมายแบบภาษาคน | Identifier | เจอที่ไหน |
|---|---|---|---|
| **Claim** | คำสัญญาที่ change ให้ไว้ เช่น "เจ้าของบัญชีบันทึกชื่อที่แสดงใหม่ได้" แต่ละ claim ระบุว่าจะตรวจอย่างไร | `claims` ใน `evidence.yaml` | [Claims](/docs/th/evidence/claims/) |
| **Capability** | ชนิดของการตรวจที่ claim ต้องการ เช่น test, พฤติกรรมบน browser, accessibility | `test`, `browser`, `accessibility`, `review`... | [Claims](/docs/th/evidence/claims/) |
| **Provider** | เครื่องมือของโปรเจกต์ที่รัน check จริง เช่น test runner หรือ Playwright ชื่อบอกว่าพิสูจน์อะไร ไม่ได้บอกว่าใช้เครื่องมือไหน | provider, adapter, `execution.yaml` | [Adapters](/docs/th/evidence/adapters/) |
| **Evidence** | ทุกอย่างที่สนับสนุน claim: ผล test, การรัน browser, review, human acceptance | `evidence.yaml`, receipt | [Receipts](/docs/th/evidence/receipts/) |
| **Receipt** | ผลที่บันทึกไว้ของ check หนึ่งครั้ง ผูกกับโค้ดและการตั้งค่าที่รันจริง receipt คือ ผ่าน, ไม่ผ่าน หรือ "ตรวจไม่ได้" | receipt | [Receipts](/docs/th/evidence/receipts/) |
| **Stale** | ผลที่ไม่ตรงกับโค้ดหรือ agreement ปัจจุบันแล้ว จึงไม่ถูกเชื่อถือและรันใหม่ เฉพาะ check ที่ invalidated เท่านั้นที่รันซ้ำ | stale, `workspace hash` | [Receipts](/docs/th/evidence/receipts/) |
| **Proof** / **proven** | check ที่จำเป็นทั้งหมดผ่านบนโค้ดปัจจุบัน แปลว่าหลักฐานดี ไม่ได้แปลว่าส่งมอบแล้ว | `proven`, `/prove <change>` | [Prove](/docs/th/loop/prove/) |
| **Gate** | check ที่จำเป็นต้องผ่านก่อน flow จะไปต่อ เช่นหลักฐานของ capability หนึ่งหรือ review | gate, assurance | [Prove](/docs/th/loop/prove/) |
| **Waiver** | การตัดสินใจที่บันทึกไว้ของคุณว่าเลิกบังคับ check ที่ไม่ผ่านหนึ่งตัว ยังมองเห็นเป็น `user-waived` ไม่เคยเป็นการผ่าน และถอนได้ | `change waive`, `user-waived` | [การอนุมัติโดยคน](/docs/th/approval/) |
| **Preview** | ภาพพฤติกรรมเบื้องต้นจากสำเนาที่ทิ้งได้ก่อน Build ช่วยตัดสินใจ แต่ไม่เคยนับเป็น proof | preview, `.foundation/previews/` | [การอนุมัติโดยคน](/docs/th/approval/) |

## การตัดสินใจ

| คำ | ความหมายแบบภาษาคน | Identifier | เจอที่ไหน |
|---|---|---|---|
| **Approval package** | หน้าอ่านอย่างเดียวที่สรุปสิ่งที่คุณถูกขอให้อนุมัติ: ความเสี่ยง อะไรเปลี่ยน ตัวอย่าง และมีหลักฐานอะไรแล้ว | `.foundation/packages/<change>.html` | [การอนุมัติโดยคน](/docs/th/approval/) |
| **Decision Sheet** | ชุดคำถามสำคัญที่มีแต่คุณตอบได้ ถามรวมครั้งเดียวแทนที่จะถามทีละข้อ | Decision Sheet, `ASK_USER` | [Change](/docs/th/loop/change/) |
| **Acceptance** | คนที่ระบุชื่อได้บอกว่าผลลัพธ์ที่เสร็จแล้วคือสิ่งที่ต้องการ จำเป็นเฉพาะเมื่อ change กำหนด | acceptance, `change resolve --acceptance-required` | [การอนุมัติโดยคน](/docs/th/approval/#acceptance) |
| **Review** | การอ่าน implementation อย่างอิสระโดย AI ตัวอื่นหรือคน เพื่อตัดสินว่าดีพอไหม | `review`, `workflow.reviewPolicy` | [การอนุมัติโดยคน](/docs/th/approval/) |
| **Risk** | ความเป็นไปได้ที่จะพลาดมากแค่ไหน: low, medium, high (มี critical ใน package) กำหนดว่า change ได้ review มากเท่าไร ไม่ใช่ขนาดของ diff | risk tier, `riskSignals` | [การอนุมัติโดยคน](/docs/th/approval/) |
| **Authority** | สิทธิ์ในการทำสิ่งที่มีผลสำคัญ เช่น Land หรือ side effect ภายนอก ให้ได้ด้วยคำพูดของคุณเองเท่านั้น ไม่เคยถูกอนุมาน | authority, `--decision-ref` | [การอนุมัติโดยคน](/docs/th/approval/) |

## การส่งมอบ

| คำ | ความหมายแบบภาษาคน | Identifier | เจอที่ไหน |
|---|---|---|---|
| **Land** | ด่านบังคับเพียงด่านเดียว เมื่อคุณให้อำนาจ harness จะ apply งานที่ proven แล้วเข้าโปรเจกต์ครั้งเดียว sync spec และ archive มันไม่ commit, push หรือเปิด PR | `/land <change>` | [Land](/docs/th/loop/land/) |
| **Archived** | change ส่งมอบแล้ว: diff อยู่ในโปรเจกต์ของคุณ ยังไม่ commit และ agreement ถูกเก็บไว้ เป็นสถานะเดียวที่แปลว่าเสร็จ | `archived`, `DELIVERED` | [Land](/docs/th/loop/land/) |
| **Handoff** | งานต่อเนื่องที่เป็นของคนนอก flow เช่นขั้นตอน deploy หรือ ticket ระบบบันทึกไว้ ไม่ได้ทำแทนคุณ | `handoffs.yaml`, `WAITING_EXTERNAL` | [Land](/docs/th/loop/land/) |
| **Resume** | ทำ change ที่ถูกขัดจังหวะต่อจากจุดที่หยุดพอดี state อยู่ในไฟล์ ไม่ใช่ในแชท | resume route, `/changes` | [หนึ่ง change ตั้งแต่ต้นจนจบ](/docs/th/journey/) |
