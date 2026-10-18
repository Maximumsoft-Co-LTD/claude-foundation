# Change Loop

[English](README.md) | **ภาษาไทย**

Change Loop ช่วยให้ AI coding agent ตกลงขอบเขตงาน ลงมือในพื้นที่แยก
ตรวจผลด้วยเครื่องมือของโปรเจกต์ แล้วนำงานกลับมาให้คุณตรวจทาน

```text
Investigate? → Change → Build → Prove → Land
```

[OpenSpec](https://github.com/Fission-AI/OpenSpec) เก็บข้อตกลง
Coding agent เขียนโค้ด ส่วน harness ดูแลสถานะ พื้นที่ทำงาน หลักฐาน และการกู้คืน
คุณยังใช้ test framework, Git และ CI เดิมได้

**Version 3.6.5** · ชื่อ package และ CLI ที่ติดตั้ง: `claude-foundation`

## เริ่มอ่านตรงไหน

README นี้สำหรับผู้ใช้ Change Loop ส่วน [คู่มือเจ้าของไฟล์](https://claude-foundation.dev/docs/th/artifacts/)
แยกเอกสารของโปรเจกต์ คำสั่งระบบที่ติดตั้ง และบันทึก runtime
เอกสารสำหรับพัฒนา Change Loop เองแยกลิงก์ไว้ด้านล่าง

| ต้องการทำอะไร | เริ่มที่นี่ |
|---|---|
| ใช้ Change Loop ในโปรเจกต์ | [ติดตั้ง](#ติดตั้ง) แล้วตาม [ตัวอย่าง change แรก](#สอนทำ-change-แรก) |
| ทำตามตัวอย่างทีละขั้น | [เริ่มใช้งาน](https://claude-foundation.dev/docs/th/quickstart/) |
| เข้าใจคำสั่งและจุดตัดสินใจ | [ภาพรวม workflow](https://claude-foundation.dev/docs/th/loop/) และ [การอนุมัติ](https://claude-foundation.dev/docs/th/approval/) |
| พัฒนา Change Loop เอง | [Contributing](CONTRIBUTING.md) → [คู่มือ maintainer](CLAUDE.md) → [คู่มือทดสอบ](.claude/tests/README.md) |
| เชื่อมต่อเครื่องมือหรือวิเคราะห์ปัญหา harness | [คู่มือ operator](.claude/harness/README.md) และ [เอกสารหลักฐาน](.claude/harness/EVIDENCE.md) |
| เตรียม release หรืออ่านผลการตรวจที่ผ่านมา | [ขั้นตอน release](RELEASING.md) และ [ดัชนีรายงาน](docs/reports/README.md) |

## ติดตั้ง

ต้องใช้ Node.js **20.19 ขึ้นไป** แนะนำให้มี Git เพื่อแยกงานด้วย worktree
ตัวติดตั้งเตรียม OpenSpec CLI เวอร์ชันที่กำหนดให้เมื่อจำเป็น
หากยังไม่มี CLI ต้องเข้าถึง npm ได้

```bash
brew tap maximumsoft-co-ltd/claude-foundation \
  https://github.com/Maximumsoft-Co-LTD/claude-foundation
brew install claude-foundation
claude-foundation init /path/to/your-project --yes
```

Claude Code ใช้ได้โดยไม่ต้องเพิ่ม adapter หากใช้ host อื่น ให้เพิ่ม
`--host cursor`, `--host opencode` หรือ `--host codex` ในคำสั่ง init
เปิด session ของ agent ใหม่หลังติดตั้ง

สำหรับโปรเจกต์ Git ให้ตรวจและ commit ไฟล์ติดตั้งก่อนเริ่ม change แรก
การติดตั้งไม่ได้ให้อำนาจ agent ทำ commit แทนคุณ

วิธีติดตั้งจาก source, ข้อกำหนด, ความต่างของ host, การใช้ headless/CI และการ
upgrade อยู่ใน [คู่มือติดตั้ง](https://claude-foundation.dev/docs/th/install/)
Agent ตรวจความพร้อมได้ด้วย `claude-foundation doctor --stage change`

## สอนทำ Change แรก

สมมติว่าต้องการให้เจ้าของบัญชีแก้ชื่อที่แสดงได้ พิมพ์คำสั่งต่อไปนี้ใน session
ของ coding agent โดยใช้ change ID ที่ agent แจ้งกลับมา

### 1. สร้างข้อตกลง

```text
/change ให้เจ้าของบัญชีแก้ชื่อที่แสดงได้
```

Agent ตรวจโค้ดที่เกี่ยวข้องและสร้างข้อตกลงใน
`openspec/changes/<change-id>/` อ่านพฤติกรรมที่ต้องการ ขอบเขต กรณีผิดพลาด
และวิธีตรวจผล จากนั้นอนุมัติ spec ที่ compile แล้วก่อนเริ่ม Build
OpenSpec packet ที่ compile แล้วคือ source of truth ของข้อตกลง

ถ้ายังไม่รู้สาเหตุหรือแนวทาง ให้เริ่มด้วย
`/investigate ทำไมการแก้โปรไฟล์บางครั้งทับข้อมูลใหม่กว่า`
ขั้นนี้สรุปสิ่งที่พบโดยยังไม่เริ่มเขียน implementation

### 2. Build ในพื้นที่แยก

```text
/build <change-id>
```

Agent เขียนโค้ดและ test ในพื้นที่ทำงานแยกที่กำหนดไว้ พร้อมดูแล setup และการแก้ไข
ตามปกติ คุณตัดสินใจเรื่องที่มีผลสำคัญ โดยไม่ต้องประกอบคำสั่งภายใน harness เอง

### 3. Prove ผลลัพธ์

```text
/prove <change-id>
```

Harness รันเครื่องมือตรวจของโปรเจกต์และใช้หลักฐานเดิมที่ยังใช้ได้ซ้ำ
Build อาจทำต่อจนถึง Prove แล้ว คำสั่งนี้จะทำส่วนที่เหลือต่อ
หลักฐานที่ขาด ไม่ผ่าน หรือสรุปไม่ได้จะแสดงตามจริง Agent แก้ปัญหาที่แก้ได้
แล้วรันซ้ำเฉพาะ checks ที่การแก้ไขทำให้ผลเดิมใช้ไม่ได้

### 4. Land งานปัจจุบัน

ตรวจผลและความเสี่ยงที่ยังเหลือ แล้วอนุญาต Land อย่างชัดเจน:

```text
/land <change-id>
```

Land นำงานปัจจุบันจากพื้นที่แยกเข้าโปรเจกต์ ปรับ spec และ archive change
ผลลัพธ์ยังเป็น **diff ที่ไม่ commit** โดย Git HEAD และ index ไม่เปลี่ยน
สถานะ `archived` หมายถึงส่งมอบโค้ดครบแล้ว ไม่ได้หมายถึง deploy
หรือผ่านการตรวจใน production

Land เป็นด่านบังคับเพียงด่านเดียว: จะ Land เฉพาะเมื่อ proof ของ workspace ปัจจุบันผ่าน
และจะ prove ใหม่ก่อนถ้า proof นั้นเก่าแล้ว ก่อนถึง Land harness จะหยุดเฉพาะเรื่องที่คุณต้องตัดสินใจ
และต้องแก้ conflict ของไฟล์ปลายทางก่อน
อ่านพฤติกรรมละเอียดใน [สัญญา Land](WORKFLOW.md#land-change)

### 5. เลือก Deliver เป็น pull request (ไม่บังคับ)

```text
/deliver <change-id>
```

คำสั่งนี้ให้อำนาจแยกสำหรับ workflow ที่ commit ในพื้นที่แยก, push branch
และเปิด PR การอนุญาต Land อย่างเดียวไม่ครอบคลุมการกระทำเหล่านี้
Deliver ไม่ merge หรือ deploy ดู [Deliver](WORKFLOW.md#deliver-change-optional)

## ควรใช้ Command ไหน

| ต้องการ | คำสั่ง |
|---|---|
| เข้าใจปัญหาก่อนเลือกแนวทาง | `/investigate <คำถาม>` |
| ตกลงสิ่งที่จะเปลี่ยน | `/change <สิ่งที่ต้องการ>` |
| ลงมือทำตามข้อตกลง | `/build <change-id>` |
| ตรวจผลหรือทำ Prove ต่อ | `/prove <change-id>` |
| นำงานเข้าโปรเจกต์และ archive | `/land <change-id>` |
| ส่งงานที่ archive แล้วให้ review ผ่าน PR | `/deliver <change-id>` |
| ดูงานที่กำลังทำและขั้นถัดไป | `/changes` |
| ใช้จุดเริ่มต้นเดียวขับ lifecycle | `/dev <สิ่งที่ต้องการ>` |

`/dev` ใช้ข้อตกลงและขอบเขตอำนาจเดียวกัน หาก requirement เปลี่ยน
แจ้ง agent เพื่อแก้ change เดิมและตรวจส่วนที่ได้รับผลกระทบ
อ่านข้อกำหนดละเอียดใน [WORKFLOW.md](WORKFLOW.md)

## Safety Boundary

- **ข้อตกลง:** อนุมัติ spec ที่ compile แล้วก่อน Build คำตอบที่ตกลงแล้วใช้ต่อได้
  ส่วนการตัดสินใจสำคัญเรื่องใหม่ยังเป็นของคุณ
- **พื้นที่แยก:** worktree หรือ directory copy ช่วยรักษางานใน workspace
  แต่ไม่ใช่ sandbox ที่จำกัดสิทธิ์ของ process
- **หลักฐาน:** เครื่องมือเป็นผู้สร้าง proof ผู้ใช้ไม่ต้องประกอบ receipt command
  หรือแก้ proof JSON ที่เครื่องเป็นเจ้าของ
- **การยอมรับผลลัพธ์:** แยกจากการอนุมัติ spec และ review
  Agent บันทึกทางเลือกด้วย `--acceptance-required` หรือ `--acceptance-not-required`
- **Review:** ค่าเริ่มต้น `independence: "self"` และ `diversity: "single-model"`
  เป็นการยกเว้น assurance อย่างชัดเจน Risk-tiered routing
  ไม่ได้ทำให้ reviewer กลับมาเป็นอิสระหรือทำให้เกิด model diversity
- **อำนาจ:** Land, การกระทำผ่าน Git และการกระทำภายนอกมีอำนาจแยกกัน
  ดู [การอนุมัติโดยคน](https://claude-foundation.dev/docs/th/approval/)

## Operator Commands และการแก้ปัญหา

| อาการ | ทำอย่างไรต่อ |
|---|---|
| ไม่พบคำสั่งหลังติดตั้ง | เปิด session ของ agent ใหม่ |
| เริ่ม Build ไม่ได้ | ให้ agent ตรวจความพร้อมและแก้ setup |
| หลักฐานเก่าใช้ไม่ได้แล้ว | ทำ `/prove` ต่อ ระบบใช้หลักฐานที่ยังใช้ได้ซ้ำ |
| Requirement เปลี่ยน | แจ้ง agent ให้แก้ change เดิม |
| Land หยุดหรือมี conflict | ทำ `/land` ต่อ รักษางานเดิมและแก้ conflict ที่ระบุ |
| ต้องการดูสถานะล่าสุด | ใช้ `/changes` |

Agent ดูแลการกู้คืนตามปกติ ถ้า target เปลี่ยนหรือ Land หยุดกลางทาง
ให้ทำ change เดิมต่อ ไม่ต้องเปิด Change ใหม่ รายละเอียดวิเคราะห์ปัญหาอยู่ใน
[คู่มือ operator](.claude/harness/README.md#troubleshooting)
อย่าแก้บันทึกใน `.foundation/` ด้วยตนเอง

<!-- Preserve existing section links; detailed topics are indexed below. -->
<a id="ai-กับ-harness-แบ่งหน้าที่กันอย่างไร"></a>
<a id="ทำไมต้องใช้"></a>
<a id="ใช้-investigate-ก่อนตกลงว่าจะเปลี่ยนอะไร"></a>
<a id="ทำความเข้าใจ-openspec"></a>
<a id="ไฟล์ใน-active-change"></a>
<a id="standard-กับ-rapid-lane"></a>
<a id="ทำความเข้าใจ-state"></a>
<a id="evidence-คืออะไร"></a>
<a id="ถ้า-requirement-เปลี่ยนระหว่าง-build"></a>
<a id="การใช้หลาย-repository"></a>
<a id="change-loop-จำกัด-scope-ของ-agent-และ-skill-อย่างไร"></a>
<a id="อะไรเป็น-source-of-truth"></a>
<a id="การอนุมัติโดยคน"></a>
<a id="ตรวจหรือ-upgrade-installation"></a>
<a id="ai-กบ-harness-แบงหนาทกนอยางไร"></a>
<a id="ทำไมตองใช"></a>
<a id="headless--ci-claude--p"></a>
<a id="ใช-investigate-กอนตกลงวาจะเปลยนอะไร"></a>
<a id="ภาพรวม-workflow"></a>
<a id="ทำความเขาใจ-openspec"></a>
<a id="ไฟลใน-active-change"></a>
<a id="standard-กบ-rapid-lane"></a>
<a id="ทำความเขาใจ-state"></a>
<a id="evidence-คออะไร"></a>
<a id="ถา-requirement-เปลยนระหวาง-build"></a>
<a id="การใชหลาย-repository"></a>
<a id="change-loop-จำกด-scope-ของ-agent-และ-skill-อยางไร"></a>
<a id="อะไรเปน-source-of-truth"></a>
<a id="การอนมตโดยคน"></a>
<a id="ตรวจหรอ-upgrade-installation"></a>

## อ่านต่อ

| เรื่อง | เอกสารละเอียด |
|---|---|
| หน้าที่ สถานะ lane และกฎ lifecycle | [WORKFLOW.md](WORKFLOW.md) |
| ไฟล์ที่สร้าง เจ้าของข้อมูล และแหล่งอ้างอิงหลัก | [Artifacts](https://claude-foundation.dev/docs/th/artifacts/) |
| นโยบาย review และขีดจำกัดการทำงาน | [foundation.json](https://claude-foundation.dev/docs/th/foundation-config/) |
| หลาย repository | [Workflow หลาย Repository](https://claude-foundation.dev/docs/th/multi-repository/) |
| Provider, receipt และความสดของ proof | [เอกสารหลักฐาน](.claude/harness/EVIDENCE.md) |
| Skill ของ agent และการเชื่อมต่อ runtime | [คู่มือ harness](.claude/harness/README.md) |
| หลักฐาน release ปัจจุบันและรายงานย้อนหลัง | [ดัชนีรายงาน](docs/reports/README.md) |

## การมีส่วนร่วม

ดูวิธีพัฒนาและตรวจสอบใน [CONTRIBUTING.md](CONTRIBUTING.md)
แจ้งปัญหาความปลอดภัยตาม [SECURITY.md](SECURITY.md)
ทุกพื้นที่ของโปรเจกต์ใช้ [Code of Conduct](CODE_OF_CONDUCT.md)

## License

MIT
