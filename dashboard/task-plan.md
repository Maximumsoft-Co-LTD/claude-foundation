# Dashboard — วิเคราะห์ requirement + แผนงาน (จาก task.md)

> **สถานะ: ทำครบทั้ง 4 WP แล้ว (2026-07-17)** — server v3 migration + client 1.9.0 + UI; ทดสอบ e2e ผ่าน (attribution, profiles, presence backfill, migration บนสำเนา DB จริง, UI demo) ยังไม่ commit

**สรุปภาพรวม: ไม่ต้องทำใหม่ (no rebuild).** สถาปัตยกรรมเดิม (bash client → zero-dep Node + SQLite) รองรับ 100 คนได้ ถ้าปรับจุดที่ระบุใน WP-D. งานทั้งหมดจัดเป็น **4 work packages** — A กับ B ทำขนานกันได้, C ต้องรอ A+B, D อิสระทำเมื่อไหร่ก็ได้

| WP | ครอบคลุมข้อ | ขนาด | ลำดับ |
|---|---|---|---|
| **A. Run ownership + size** | bug attribution, size/points | M | ทำก่อน (bug จริง + ปลดล็อก points) |
| **B. Identity & profiles** | profile/team tag, ส่วนหนึ่งของ dedup | M | ขนานกับ A |
| **C. Filters + workload UI** | filter team/org/สี, team workload เทียบช่วง | M | หลัง A+B |
| **D. Scale pass** | heartbeat, 100 คน, dedup hardening | M | อิสระ |

---

## วิเคราะห์รายข้อ

### 1) heartbeat default 1 นาที นานไปไหม
**ข้อเท็จจริง: default ไม่ใช่ 1 นาที — คือ 15 วินาที** (`client.sh:71 INTERVAL=15`, TTL online 30s ที่ `server.js:24`). ตัวที่เป็น 60s คือ repo-scan (`SCAN_INTERVAL`, client.sh:79) ซึ่งเป็นคนละ knob; usage scan = 300s.
- 15s เหมาะกับทีมเล็ก แต่ที่ 100 คน = ~6.7 write req/s และตาราง `heartbeats` โต ~576k แถว/วัน (~17M แถวที่ retention 30 วัน)
- **แผน (อยู่ใน WP-D):** ขยับ INTERVAL → 30–60s + ตั้ง `ONLINE_TTL_MS` = 2× interval ตามคำแนะนำใน `.env.example` เอง; และเปลี่ยน raw heartbeat log → aggregate รายชั่วโมง (Presence ใช้ granularity รายชั่วโมงอยู่แล้ว ไม่เสียฟีเจอร์)

### 2) My profile + tag ทีม (ใช้ทั้งองค์กร)
**ยังไม่มีอะไรรองรับเลย** — ไม่มี field team/tag/org ใน schema, payload, UI (ยืนยันจาก grep ทั้ง 4 ไฟล์). ปัญหาฐานราก: ระบบไม่มี "คน" — มีแต่ `agentId` (ต่อเครื่อง) กับ `gitUser` (free text, server รับจาก body โดยไม่ verify — `server.js:609`; ชื่อซ้ำ = ถูกรวมเป็นคนเดียว, ชื่อสะกดต่าง = แยกเป็นคนละคน)
- **แผน (WP-B):** เพิ่มตาราง `profiles` (person_key PK, display_name, org, teams JSON, color) + endpoint `GET/PUT /api/profile` + หน้า "My profile" ใน UI ให้เลือกว่าตัวเองคือใคร/อยู่ทีมไหน + client ส่ง `CLAUDE_FOUNDATION_TEAMS` ได้เป็น fallback
- person_key = email จาก `git config user.email` (normalize) แทน user.name — เสถียรกว่าและชนกันยากกว่า
- **หมายเหตุใช้ทั้งองค์กร:** SHARED_KEY เดียวแปลว่าใครก็ claim ชื่อใครก็ได้ — ระยะถัดไปควรออก per-user key (admin ออก key ผูก person_key) ถึงจะกัน spoof ได้จริง (stretch ของ WP-B)

### 3) Filter whole team → tag ทีม / องค์กร / บุคคล + ใส่สี
ตอนนี้ filter เป็น **single-select ต่อคนเท่านั้น** (`app.js:889 currentUser` string เดียว) และ**ไม่มีสีต่อคนเลย** — กราฟ by-person ทุกตัวใช้สีเดียว `var(--signal)` (app.js:243, 395, 511)
- **แผน (WP-C):** filter เป็น multi-select จัดกลุ่ม org → team → person (อ่านจาก profiles); เลือก tag = เลือกสมาชิกทั้ง tag; >1 คน → assign สีต่อคนจาก palette คงที่ (hash person_key → palette, override ได้ใน profile) แล้วใช้สีนั้นทุกกราฟ/ตาราง/ chip ให้ตรงกันทั้งหน้า

### 4) รองรับ 100 คน ต้องปรับอะไร
คอขวดที่เจอจริงในโค้ด (WP-D ทั้งหมด):
1. **`/api/online` อ้วนและคำนวณใหม่ทุก request** — ส่ง state ทั้งหมด (usage cap 12,000 แถว, runs 400, work 2,000) ทุก 5s ต่อ browser tab และ recompute `computeConflicts()` O(files×parties²) + `dedupeRuns()` ทุกครั้ง (server.js:925-929) → ใส่ memo cache 2–5s (คำนวณครั้งเดียวต่อรอบ ให้ทุก viewer ใช้ร่วม), แยก endpoint ตาม tab, และให้ browser poll ช้าลงเมื่อ tab hidden
2. **`heartbeats` โต 17M แถว** → aggregate รายชั่วโมง (ข้อ 1 ด้านบน)
3. **ไม่มี prune เลยนอกจาก heartbeats** — `usage_daily`, `file_edits`, `conflict_log`, `commits_daily`, `work_daily`, `runs` โตตลอดกาล → เพิ่ม retention job + index รอง (ตอนนี้มีแค่ idx บน heartbeats; `/api/history` scan ด้วย PK leading column)
4. `/api/history` hardcode 120 วัน ทุก 60s ต่อ tab (app.js:436-454) → ผูกกับ range filter ที่ผู้ใช้เลือกจริง
- SQLite + Node เดี่ยว **พอ** ที่ scale นี้ — ไม่ต้องเปลี่ยน stack

### 5) แต่ละคนส่งเฉพาะข้อมูลตัวเอง + กันข้อมูลซ้ำ
สถานะปัจจุบันแยกตามชนิดข้อมูล (สำคัญ — อย่าเหมารวม):
| ข้อมูล | แหล่ง | ปลอดภัยไหม |
|---|---|---|
| usage / sessions / tools | transcript เครื่องตัวเอง, dedupe ด้วย message id | ✅ ของตัวเองแน่ |
| work_daily ("my output") | `git log --author=<me>` | ✅ (แต่ระวัง repo-local user.name ≠ ชื่อ dashboard → ลง person_key ใน WP-B) |
| file_edits / changes | diff working tree ตัวเอง | ✅ โดยธรรมชาติ |
| **runs** | scan `.workflow/*/state.json` **ของทุกคนที่ pull มา** | ❌ ข้อ 6 |
| commits_daily | `git log` **ทุก author** ใน repo (client.sh:312-313) | ⚠️ เป็นยอดรวมต่อ repo (ตั้งใจ) — server MAX-merge กันนับซ้ำแล้ว (server.js:153-157) |
- **แผน:** เอกสาร ownership matrix นี้ลง README + (WP-A) แก้ runs ให้มีเจ้าของ + (WP-B) person_key ทำให้ rollup ต่อคนไม่พังเพราะชื่อ free-text + (WP-D stretch) per-user key กัน spoof. คนเดียว 2 เครื่อง: work_daily มี MAX-merge ฝั่ง UI แล้ว (app.js:295-311); usage ตั้งใจบวกรวม (2 เครื่อง = ใช้จริง 2 ก้อน) — ถูกแล้ว ไม่ต้องแก้

### 6) Bug: activity ขึ้นชื่อฉันทั้งที่ไม่ได้ทำ
**Root cause ยืนยันแล้ว:** run จาก `.workflow/*/state.json` ไม่มี field เจ้าของ (client.sh:243 ส่งแค่ id/type/repo/branch/phase/…) → server ประทับชื่อ **คนที่รายงาน** ลงทุก run (`server.js:701 gitUser: a.gitUser`) และ dedupe แบบ last-reporter-wins — พอ `.workflow/` ถูก commit แล้วเพื่อน pull ไป เครื่องเพื่อนก็รายงาน run ของเราเป็นของเขา (หรือกลับกัน) แถม key dedupe ใช้ `basename(repo_root)` ไม่ใช่ repoId จริง ชนข้าม repo ชื่อซ้ำได้อีก
- **แผนแก้ (WP-A) 3 ชั้น:**
  1. orchestrator เขียน `owner` (git user.name + email) ลง state.json ตอนสร้าง run — แก้ `.workflow/_templates/state.json` + `orchestrator.md` (ไฟล์อยู่ใน repo นี้เอง แก้ที่ต้นทางได้)
  2. client: run เก่าที่ไม่มี owner → fallback `git log --format='%an' -1 -- .workflow/<id>/` (author คน commit artifact แรก); หาไม่ได้ = ส่ง owner ว่าง
  3. server: ใช้ owner จาก payload ก่อนเสมอ, ชื่อ reporter เป็นแค่ fallback สุดท้าย; เปลี่ยน run key → normalized repoId เดียวกับ changes

### 7) วัด size ของงาน / คะแนนต่อวัน — วัดยังไง
ยังไม่มี field size/points ที่ไหนเลย proxy ที่มีอยู่: duration ของ run, lines added/deleted, commits/pushes/PRs, จำนวนไฟล์
- **ข้อเสนอ (WP-A ต่อยอด — แก้ state.json ครั้งเดียวได้ทั้ง owner+size):** `/dev` มี size tier XS/S/M/L อยู่แล้ว (plan-writing size-tiering) → orchestrator เขียน `size` ลง state.json → client ส่งต่อ → **points = weight ต่อ run ที่จบ** (XS=1, S=2, M=5, L=8) รวมต่อคนต่อวัน
- แสดง points เป็นคอลัมน์หลัก + proxy เดิม (commits/lines/tokens) เป็นคอลัมน์ประกอบ **แยกกัน อย่ารวมเป็นสูตรเดียว** — lines/commits ถูก game ง่าย และ points วัด "ขอบเขตงานที่วางแผน" ไม่ใช่ความเหนื่อยจริง ต้องสื่อสารตรงนี้ชัดใน UI

### 8) Team workload — ใครหนัก/เบา, เพิ่ม/ลดจากเดิม ตาม filter ช่วงเวลา
ยังไม่มี UI เทียบช่วงเวลาเลย (ยืนยันจาก app.js — range เป็น absolute window เดียว)
- **แผน (WP-C):** section "Workload" ใน Insights: ต่อคน (ตาม filter ทีม/องค์กร) แสดง points + proxy ของ **ช่วงที่เลือก** เทียบ **ช่วงก่อนหน้าที่ยาวเท่ากัน** (เลือก 1 วัน → เทียบเมื่อวาน, 7 วัน → เทียบ 7 วันก่อนหน้า) + delta % ลูกศรขึ้น/ลง สีต่อคนจากข้อ 3
- ข้อมูลมีครบแล้ว (`work_daily`, `runs`, `usage_daily`) — งานส่วนใหญ่คือ frontend + ปรับ `/api/history` ให้รับ range

---

## WP-E — Scan coverage fixes ✅ (ทำแล้ว 2026-07-17, client 1.10.0; e2e ผ่าน: branch-commit บน repo clean ถูกนับ, worktree ถูก scan + conflict ข้าม branch, work ไม่นับทบต่อ repoId)

**เป้า:** ตัวเลข "งานของฉัน" ครบไม่ว่าจะทำงานท่าไหน — commit บน branch ไหน, ใน worktree, หรือ commit เสร็จจน tree สะอาดแล้ว. ขนาดรวม **S–M**, ไฟล์หลัก `client.sh` + จุดเล็กใน `server.js`, ไม่มี schema migration.

### E1 — นับทุก local branch (ไม่ใช่แค่ HEAD)
- `client.sh` จุด `commits_daily` (`git log --since=14.days --pretty='%ad'`) และ `work_daily` (`git log --since=14.days --author="$me" --numstat`): เติม `--branches`
- commit เดียวกันที่อยู่หลาย branch นับครั้งเดียวตาม hash (พฤติกรรม git log ปกติ) — ไม่ต้อง dedupe เอง
- ความเสี่ยง: branch เก่าค้าง repo → มี `--since=14.days` คุมอยู่แล้ว

### E2 — รองรับ linked worktree (`.git` เป็นไฟล์)
- pass-1 ของ `scan_changes`: `find ... -name .git -type d -prune -print` มองไม่เห็น worktree (`.git` เป็นไฟล์) → เพิ่ม `-o -name .git -type f -print` และเปลี่ยนเช็ค `[ -d "$root/.git" ]` → `[ -e ... ]`
- **ต้องมาคู่กับ dedupe ต่อ repoId ภายในเครื่อง**: main checkout + worktree (และ repo ที่ clone ซ้ำสองที่) ชี้ remote เดียวกัน — ถ้าปล่อยให้ทุก root รายงาน `commits/work/pushes` จะบวกทบใน `workRowsFor()` (ฝั่ง server รวมข้าม changes[] entries). กติกา: root แรก (ใหม่สุดตาม recency) ของแต่ละ repoId เท่านั้นที่แนบ `commits/work/pushes/fuOpen`; root ถัดไปแนบเฉพาะ `files` (ยังต้องส่งเพื่อ conflict detection ข้าม branch — นั่นคือประโยชน์หลักของ worktree scan)
- bash 3.2: เก็บ seen repoIds เป็น string + `case` match (ไม่มี assoc array)
- โบนัส: ปิดบั๊กเดิม "clone ซ้ำสองที่ = work นับสองเท่า" ไปในตัว

### E3 — repo ที่ clean แล้วต้องไม่หายจากสถิติ
- pass-1: repo ที่ diff ว่าง → เช็คต่อ `git log -1 --since=14.days --branches --format=%ct`; ถ้ามี commit ล่าสุด ให้เข้ารอบ pass-2 แบบ "clean" (mt = เวลา commit ล่าสุด)
- pass-2: clean repo ข้ามส่วน diff, ส่ง entry ที่ `files:[]` แต่มี `commits/work/pushes/fu*`
- **ฝั่ง server ต้องแก้ 2 จุด**: (1) `cleanChanges()` ตอนนี้ทิ้ง entry ที่ `files` ว่าง → ผ่อนเป็น "รับถ้ามี files หรือ work/commits/pushes" (2) `snapshot()` การ์ด "working in" ให้แสดงเฉพาะ entry ที่ `files > 0` เหมือนเดิม (repo clean ไม่ใช่ "กำลังทำ")
- cap: dirty repos ได้คิวก่อนเสมอ; clean เข้าเพิ่มด้วย cap แยก (`CLEAN_REPO_CAP` ~10) กันเบียด `CHANGES_REPO_CAP` 20

### ทดสอบ (e2e กับ server local เหมือนรอบ WP-A–D)
1. repo ปลอม: commit บน branch `feat/x` แล้ว checkout `main` → work_daily ต้องยังเห็น commit นั้น (E1)
2. `git worktree add` + แก้ไฟล์ใน worktree → changes ต้องรายงาน branch ของ worktree และ work ไม่นับซ้ำ (E2)
3. repo clean ที่มี commit เมื่อวาน → ยังโผล่ใน Workload/commits, ไม่โผล่ใน "working in" (E3)
4. `bash -n client.sh`, `node --check server.js`, client `--once` จริง
- bump `CLIENT_VERSION` → 1.10.0; README: อัพเดต Limitations (ลบ "tracked changes only" บางส่วน, เพิ่มพฤติกรรม branch/worktree/clean)

## ลำดับที่แนะนำ

```
WP-A (owner+size ใน state.json → client → server)   ┐
WP-B (person_key + profiles + teams/org + สี)        ┤→ WP-C (multi-filter + สี + workload compare)
WP-D (intervals, presence aggregate, cache, prune)   ┘   (D อิสระ ทำแทรกเมื่อไหร่ก็ได้)
```

- แต่ละ WP = 1 `/dev` run ขนาด M (A กับ B ควรแยก run เพราะคนละไฟล์เกือบทั้งหมด แต่ทั้งคู่แตะ schema server.js → ประสาน migration version กัน)
- WP-A ควรไปก่อนสุด: เป็น bug ที่ user เห็นจริง และ field `size` ที่ใส่พร้อมกันปลดล็อกข้อ 7+8
- สิ่งเดียวที่อาจต้อง "ทำใหม่" ในอนาคต (ไม่ใช่ตอนนี้): เปลี่ยน SHARED_KEY เดียว → per-user key ถ้าจะเปิดใช้ทั้งองค์กรจริงจัง
