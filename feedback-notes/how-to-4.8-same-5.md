# ใช้ Opus 4.8 ให้ทำงานเก่งใกล้ Fable 5

> สรุปจากเอกสารทางการ Anthropic + งานวิเคราะห์ benchmark ภายนอก (ก.ค. 2026)

## ประเด็นสำคัญที่สุด

ช่องว่างระหว่าง Fable 5 กับ Opus 4.8 ใหญ่จริงในงาน agentic ระยะยาว (SWE-Bench Pro: 80.3% vs 69.2%) แต่ **ปิดได้เกือบหมดด้วย verification loop ภายนอก** — benchmark ที่ harness ให้ error feedback ทันที (เช่น Terminal-Bench) สองโมเดลคะแนนใกล้กันมาก เพราะจุดแข็งหลักของ Fable 5 คือ self-verification ภายใน ซึ่งสร้างทดแทนจากข้างนอกได้ และบางงาน Opus 4.8 ชนะอยู่แล้ว (GPQA Diamond 93.6 vs 92.6, hallucinate น้อยกว่า, ถูกกว่า 2 เท่า)

## 1. ตั้งค่า API ให้ถูก

- `thinking: {type: "adaptive"}` — **ต้องใส่เอง** บน Opus 4.8 ถ้าไม่ใส่ = ไม่คิดเลย (ต่างจาก Fable 5 ที่เปิดตลอด) จุดที่คนพลาดบ่อยสุด
- `output_config: {effort: "xhigh"}` สำหรับ coding/agentic (ค่าที่ Claude Code ใช้), ขั้นต่ำ `high` สำหรับงานที่ต้องใช้ความฉลาด — effort มีผลกับรุ่นนี้มากกว่า Opus รุ่นไหน ๆ
- ที่ `xhigh`/`max` ตั้ง `max_tokens` ≥ 64k ให้มีที่คิด + เรียก tool
- งาน agentic loop ยาว ใช้ task budget (beta `task-budgets-2026-03-13`) ให้โมเดลรู้งบและจัดลำดับงานเอง
- อย่าใส่ `temperature` / `top_p` / `budget_tokens` — 400 ทันที

```python
client.messages.create(
    model="claude-opus-4-8",
    max_tokens=64000,
    thinking={"type": "adaptive"},
    output_config={"effort": "xhigh"},
    messages=[...],
)
```

## 2. Prompt แบบที่ 4.8 ตอบสนอง

- **สเปกงานครบในเทิร์นแรก** แล้วปล่อยให้ทำยาว ๆ — 4.8 autonomous มาก prompt ที่ค่อย ๆ ป้อนทีละนิดทำให้ทั้งแพงและโง่ลง
- ตีความตรงตัวมาก — ระบุ scope ชัด ("ทำทุก section ไม่ใช่แค่อันแรก") เขียนบอกว่า*ต้องการอะไร* ไม่ใช่สคริปต์ทีละขั้น
- 4.8 ชอบคิดมากกว่าเรียก tool → อยากให้ search/ใช้ tool มากขึ้น: เพิ่ม effort + เขียน trigger ใน tool description ("เรียก tool นี้เมื่อ...") — ได้ผลวัดได้
- บอกให้ใช้ subagent/memory ชัด ๆ ("งานที่ fan-out หลายไฟล์ให้แตก subagent, เช็ค memory file ก่อนเริ่มงานยาว") — 4.8 under-reach พวกนี้โดย default
- ให้ความ autonomy: "เรื่องเล็ก (ตั้งชื่อ, default value) เลือกเองแล้วโน้ตไว้ อย่าถาม" — ลด ask-rate ได้ ~12 จุด

## 3. สร้าง "self-verification" แบบ Fable 5 ด้วย harness

ตัวปิดช่องว่างจริง ๆ:

- ให้ test / linter / typecheck รันอัตโนมัติหลังแก้ไฟล์ทุก batch แล้วป้อน error กลับทันที
- สั่งใน prompt ให้ตั้ง checking loop เอง: "สร้างวิธีตรวจงานตัวเอง รันทุก N ขั้น เทียบกับ spec"
- ใช้ verifier แยก context (subagent ใหม่มารีวิว) แทน self-critique — ได้ผลกว่า
- Code review: สั่ง "รายงานทุก finding พร้อม confidence/severity แล้วค่อยกรองทีหลัง" — 4.8 ทำตามคำสั่ง "อย่าจุกจิก" ตรงเกินจน recall ตก

## 4. เลือกงานให้ถูกโมเดล

Fable 5 แพง 2 เท่า ($10/$50 vs $5/$25 ต่อ MTok) — pattern ที่ทีมส่วนใหญ่ใช้: **Opus 4.8 + harness ที่ดีเป็น default** ส่งเฉพาะงานยากสุด (migration ใหญ่, overnight run) ไป Fable 5 เมื่อต้นทุนของ "งานล้มเหลว" แพงกว่าค่า token

## Sources

- [Prompting Claude Opus 4.8 — official docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8)
- [Claude Fable 5 vs Opus 4.8 for Coding Agents — Verdent](https://www.verdent.ai/guides/claude-fable-5-vs-opus-4-8-coding)
- [SWE-Bench gap analysis — tech-insider.org](https://tech-insider.org/claude-fable-5-vs-opus-4-8-2026/)
- [codingfleet comparison](https://codingfleet.com/blog/claude-fable-5-vs-claude-opus-4-8/)
