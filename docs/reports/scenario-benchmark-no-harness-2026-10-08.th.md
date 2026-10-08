# ผล scenario benchmark แบบไม่มี harness (2026-10-08)

[English](scenario-benchmark-no-harness-2026-10-08.md)

รันเพิ่มจริง 10 scenarios ฝั่งไม่มี harness รุ่นละ 1 รอบ แล้วเทียบกับ
[ผล v3.6.0–v3.6.2 เดิม](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md)
ทั้งสี่ฝั่งส่งมอบสำเร็จ 9/10 และตก Project Tracker ข้อเดียวกัน รอบนี้ฝั่งไม่มี
harness เร็วกว่าและถูกกว่า ยังไม่พบความถูกต้องที่ดีขึ้นจาก Change Loop ในชุดนี้
ผลรอบเดียวไม่ใช่ข้อสรุปความเร็วที่สม่ำเสมอ, production assurance หรือคุณภาพทุก skill

## เงื่อนไขและขอบเขตที่ต่างกัน

ใช้ frozen seed เดียวกัน แต่ไม่ติดตั้ง Change Loop, OpenSpec, lifecycle หรือ
CLI shim ใน baseline โมเดลแก้ implementation และ tests ตรงในโปรเจกต์ รัน
คำสั่งทดสอบหลักและทิ้ง diff ไว้โดยไม่ commit มีเพียง seed commit เริ่มต้นของ
lab ชั่วคราว การตั้งค่า host ส่วนตัวทั่วไปยังใช้เหมือนเดิม จึงไม่ได้หมายถึง
ปิด skills หรือ plugins ทุกตัว

โมเดลหลักที่สังเกตจริงคือ `claude-sonnet-5-5`; ใช้ Claude Code 2.1.294,
Node 26.3.0 บน macOS เครื่องมือ benchmark มาจาก clean v3.6.2 commit
`50ad2ce4d5ceccb8bee0c1b8c44d5387617fadec` แต่ไม่ได้ติดตั้ง runtime นี้ใน baseline
runner, fixture, oracle, quality scripts และ dependency tooling เหมือนกัน
ตรวจ manifests และ tool profile ว่า baseline ไม่เรียก harness ตรวจ hash,
source สะอาด, frozen seed และ actual model ผ่านครบ 40 bundles

โจทย์และคำแนะนำเรื่อง partitions เหมือนกัน baseline ตัด slash command และ
คำสั่ง lifecycle ออก ใช้สิทธิ์แก้ไฟล์, รัน tests และอ่าน Git ตาม protocol
oracle รันหลัง host ออกและไม่มีการซ่อมตาม hidden oracle อัตโนมัติ ฝั่ง Change
Loop หยุดที่ `proven`, ตรวจ oracle ก่อน Land, เรียก session ซ่อมได้ และต้อง
`archived` พร้อม delivery checks จึงผ่าน baseline ไม่มีเกณฑ์ archived

รันพร้อมกันสูงสุด 8 hosts งบ $2 ต่อ run เพิ่มไม่เกิน $20 ภายในงบรวม $40 เดิม
baseline รันภายหลังและใช้หลักฐานสามรุ่นเดิมมาเทียบ ช่วงเวลา, โหลดบริการ, แคช,
ชุดงานที่รันพร้อมกันและผลโมเดลจึงไม่ใช่คู่ที่รันสลับในเวลาเดียวกัน

## ผลเปรียบเทียบ

เวลาต่อไปนี้เป็นผลรวมของ 9 คู่ที่ส่งมอบสำเร็จร่วมกัน ไม่รวม tracker ที่ล้มเหลว
และไม่ใช่เวลา elapsed ของ batch ที่รันพร้อมกัน

| ผล | ไม่มี harness | v3.6.0 | v3.6.1 | v3.6.2 |
|---|---:|---:|---:|---:|
| Oracle, ส่งมอบและ clean install ผ่าน | 9/10 | 9/10 | 9/10 | 9/10 |
| คุณภาพโค้ดที่วัดได้ผ่าน | 9/10 | 9/10 | 9/10 | 9/10 |
| เวลา host รวม 9 คู่ | 479.6 วินาที | 842.3 วินาที | 747.4 วินาที | 847.9 วินาที |
| เวลา lab รวมการตรวจส่งมอบ 9 คู่ | 495.2 วินาที | 953.8 วินาที | 855.0 วินาที | 940.6 วินาที |
| ค่า host ของ 9 คู่ | $2.0714 | ไม่ทราบครบ | $3.5514 | $3.6917 |
| Model requests ของ 9 คู่ | 63 | 98 | 93 | 96 |

เวลา host ของ baseline จบเมื่อโมเดลออก ส่วน Change Loop วัดถึง `proven`
จึงมีจุดสิ้นสุดต่างกัน เวลา lab รวม oracle, quality, backend Land ของ Change
Loop, project tests และ clean install แต่ไม่รวมเตรียม fixture/ติดตั้งตอนเริ่ม
ต้องเก็บทั้งสองค่า ไม่ตีความเวลา host เป็นเวลาของ harness ล้วน ๆ

| Change Loop เทียบไม่มี harness | เวลา host เพิ่ม | เวลา lab เป็นเท่า | ค่า host เพิ่ม | คู่ที่วัดค่าครบ |
|---|---:|---:|---:|---:|
| v3.6.0 | +75.6% | 1.93 เท่า | +66.9% | 8 |
| v3.6.1 | +55.9% | 1.73 เท่า | +71.5% | 9 |
| v3.6.2 | +76.8% | 1.90 เท่า | +78.2% | 9 |

ค่า Python ของ v3.6.0 ยังไม่ทราบ จึงเทียบต้นทุนรุ่นนั้นใน 8 คู่ที่วัดครบ:
baseline $1.9005 เทียบ Change Loop $3.1728 อีกสองรุ่นมีค่าครบทั้ง 9 คู่
ไม่แทนค่าเงินที่ขาดหรือไม่ครบด้วยศูนย์

### ผล baseline ราย scenario

| Scenario | วินาที host | ค่า host | Model requests | Oracle |
|---|---:|---:|---:|---:|
| bare-node-boundary | 41.7 | $0.2168 | 7 | 6/6 |
| typescript-react-state | 28.9 | $0.1730 | 6 | 6/6 |
| python-api-validation | 23.9 | $0.1709 | 6 | 5/5 |
| database-migration-rollback | 62.9 | $0.2103 | 7 | 6/6 |
| refactor-no-reproduction | 33.8 | $0.1647 | 5 | 6/6 |
| multi-service-event-flow | 37.0 | $0.1902 | 7 | 6/6 |
| tiny-feature | 51.1 | $0.1927 | 8 | 8/8 |
| notes-api | 124.1 | $0.4287 | 9 | 13/13 |
| cart-coupons | 76.2 | $0.3241 | 8 | 11/11 |
| project-tracker-api | 187.2 | $0.6313 | 10 | 32/33, ไม่ผ่าน |

Tracker ตก `CASE_TESTS_EXIST` เหมือนทั้งสามรุ่นที่มี harness แม้ tests ปกติของ
baseline ผ่าน แต่ยังไม่ผ่านเกณฑ์ tests ของ hidden oracle จึงไม่วัด quality
หรือตรวจ clean install ต่อสำหรับ run นั้น oracle ต้องมีอย่างน้อย 15 tests
ที่ผ่านและ suite ต้องจับข้อบกพร่องใน seed เดิมได้ ไม่ลดเกณฑ์และไม่ถือ run
ที่ล้มเหลวเป็นการส่งมอบเร็วขึ้น ผลนี้ยังไม่ชี้ว่า harness เป็นสาเหตุของข้อที่ตก

## หลักฐานที่เก็บไว้และข้อจำกัด

ค่า host ของ baseline ครบ 10 runs รวม run ที่ล้มเหลวคือ $2.7026468
ค่าใช้จ่ายที่ทราบของทั้งสี่ฝั่งรวมอย่างน้อย $16.1001206 หากกันเต็ม $2 สำหรับ
Python ของ v3.6.0 ที่ยังไม่ทราบ ยอดที่กันไว้คือ $18.1001206 ภายในงบ $40
ตัวเลขเป็น CLI host result/งบ ไม่ใช่ยอดใบแจ้งหนี้ ไม่ได้วัดค่าที่ provider
หรือ reviewer อาจเรียกเก็บแยก

สำรองข้อมูลดิบครบ 40 runs นอก state ของ repository:

```text
~/.local/share/changeloop/benchmarks/2026-10-08-with-no-harness-1791472711421.tar.gz
SHA256 2cae148457c27a00f767e93569cb850b8a4866cb095d01a46323fd0e164cf08e
```

ตรวจ checksum ก่อนอ่าน `summary-with-baseline.json` และตรวจ hashes ใน
`runs/<run-id>/integrity.json` สำเนา 30 runs และรายงานตามวันที่เดิมยังคงอยู่
ไม่รวม source worktrees/dependencies ใน archive และไม่เก็บ raw logs/results ใน Git

release ถัดไปใช้ [RELEASING.md](../../RELEASING.md) อ้างอิง baseline นี้ได้เมื่อ
โจทย์, โมเดล, งบและวิธีวัดตรงกัน มิฉะนั้นต้องเก็บคู่เทียบใหม่ในขอบเขตที่อนุมัติ
ต้องมีหลายรอบและค่าความแปรปรวนก่อนอ้างความเร็วที่สม่ำเสมอ baseline ไม่ได้ให้
agreement, isolation, proof และ recoverable Land แบบ Change Loop ชุดนี้วัด
ผลโจทย์ benchmark ไม่ได้วัดคุณค่าของการรับประกันเหล่านั้น

## อัตราส่วนราย scenario และขอบเขตงานใหญ่

ไม่มี harness = 1.00 เท่า แต่ละช่องคือ เวลา lab / ค่า host ค่ามากกว่า 1 คือ
ใช้เวลาหรือค่าใช้จ่ายมากกว่า คำนวณจากค่าดิบก่อนปัดเศษในตารางด้านบน

| Scenario | v3.6.0 | v3.6.1 | v3.6.2 |
|---|---:|---:|---:|
| bare-node-boundary | 1.80 / 1.38 | 2.06 / 1.77 | 1.59 / 1.66 |
| typescript-react-state | 2.52 / 1.99 | 2.09 / 2.04 | 2.29 / 2.34 |
| python-api-validation | 3.42 / ไม่ทราบ | 2.29 / 1.89 | 2.27 / 2.05 |
| database-migration-rollback | 1.50 / 1.67 | 2.00 / 1.90 | 1.52 / 1.67 |
| refactor-no-reproduction | 2.92 / 2.82 | 2.02 / 2.12 | 2.05 / 2.50 |
| multi-service-event-flow | 2.42 / 1.80 | 2.73 / 1.96 | 3.33 / 2.24 |
| tiny-feature | 1.06 / 1.59 | 1.03 / 1.57 | 1.36 / 1.69 |
| notes-api | 2.06 / 1.39 | 1.34 / 1.29 | 1.89 / 1.13 |
| cart-coupons | 1.32 / 1.45 | 1.47 / 1.59 | 1.73 / 1.79 |
| รวมงานที่ผ่าน | 1.93 / 1.67 | 1.73 / 1.71 | 1.90 / 1.78 |

ผลรวมคืออัตราส่วนของยอดสะสม ไม่ใช่ค่าเฉลี่ยอัตราส่วนราย scenario เวลาใช้ 9 คู่
ต้นทุน v3.6.0 ใช้ 8 คู่ อีกสองรุ่นใช้ 9 คู่ ไม่รวม Tracker ที่ล้มเหลว

งานที่มีขอบเขตกว้างในชุดนี้ได้แก่ Project Tracker API (oracle 33 ข้อ;
auth/roles/permissions, projects/tasks, filtering/pagination, persistence และ
concurrency), Notes API (13 ข้อ; CRUD และ query behavior) และ Multi-service
event flow (6 ข้อ; producer/consumer contract, compatibility และ idempotency)
Tracker ถูกทดสอบจริง แต่ผ่าน 32/33 ทุกฝั่ง จึงไม่อยู่ในอัตราส่วนงานที่ส่งมอบสำเร็จ

ทั้งหมดเป็นโปรเจกต์จำลองที่ทำได้ในหนึ่ง session ในการเทียบ 40 runs นี้ยังไม่ได้ทดสอบงานหลายวัน,
การเปลี่ยนแปลงหลาย Git repositories หรือระบบ production จริง การมีหลาย services
ใน fixture ไม่ได้พิสูจน์ workflow หลาย repositories รายงานนี้จึงไม่รองรับ
ข้อสรุปประสิทธิภาพหรือความพร้อมของงานใหญ่ระดับนั้น

มีงาน API keys ข้าม 3 repositories แยกอยู่แล้ว: gateway (root), users
(Git submodule) และ SDK (writable sibling checkout) โดยเก็บ
[semantic draft](../../.claude/tests/harness/fixtures/large-change/api-keys.draft.json)
และ [packet regression](../../.claude/tests/harness/run-large-change-packet-tests.sh)
จากงานจริงไว้ ทดสอบ 3 tasks รวม 34 claims และประมาณ 22 paths ที่เปลี่ยน
ผ่าน Change ถึงขอบเขต Build แล้วตรวจขนาด packet และพฤติกรรม task ที่เสร็จแล้ว
นี่ไม่ใช่ benchmark ส่งมอบงานครบวงจร และไม่ได้รวมในการเทียบ 4 แบบข้างต้น
จึงยังไม่มีอัตราส่วนประสิทธิภาพระหว่างรุ่นหรือเทียบกับไม่มี harness สำหรับงานนี้

## Scenario เดิมที่อยู่นอกการเปรียบเทียบนี้

ตรวจเทียบ paid matrix, task directories และรายงาน live เดิมแล้ว รอบนี้รันครบ
10 งานใน paid matrix ปัจจุบันทั้ง 4 แบบ แต่ fixture เดิม 14 จากทั้งหมด 24 งาน
ยังอยู่นอก matrix และไม่ได้รวมในการเปรียบเทียบนี้:

| กลุ่ม | Fixture ที่ไม่ได้เทียบ |
|---|---|
| Browser UI และเว็บไซต์ | `01-task-list`, `06-landing-site` |
| Utility ขนาดเล็ก | `02-csv-format`, `03-form-validator`, `04-paginate`, `05-debounce` |
| Security | `07-session-token` |
| Compatibility และ migration | `08-name-migration`, `09-api-compat` |
| ความถูกต้องของงานเงิน | `10-rounding-fix`, `13-money-drift` |
| Search และการเปลี่ยนแปลงสะสม | `12-contact-search`, `14-accumulate`, `14b-sort-only` |

หลายงานมีผล live เดิมใน
[รายงาน real-user วันที่ 2026-08-28](consumer-e2e-real-user-10-scenario-2026-08-28.md)
แต่ไม่ใช่ผลวัด v3.6.0–v3.6.2 ใน 14 directories นี้มีเพียง contact-search และ
money-drift ที่มี `oracle/run.sh` มาตรฐาน จึงต้องตรวจหรือเตรียม acceptance checks
ของงานอื่นก่อนเพิ่มเข้า benchmark ส่งมอบงานที่เทียบกันได้ ชื่องานคล้ายกับ matrix
ใหม่ไม่ได้แปลว่าครอบคลุม fixture เก่าเหล่านี้แล้ว

งาน API keys 3 repos ข้างต้นก็ไม่ได้รวมเช่นกัน ส่วน lifecycle probes
([รายงาน 10 sessions](e2e-live-10-scenario-2026-08-23.md)) และ harness diagnostics
([รายงาน 20 sessions](e2e-live-20-scenario-2026-08-25.md)) ตรวจ investigation,
authority, leases, isolation และ recovery แยกจากการวัดประสิทธิภาพส่งมอบงาน
lane `budget-exhaustion-resume` ใน matrix ปัจจุบันเป็น deterministic sentinel
ไม่ใช่หนึ่งใน 40 paid runs และมี
[installed multi-repository recovery regression](../../.claude/tests/harness/run-installed-recovery-tests.sh)
ตรวจ interruption ระหว่าง dependency waves และการรักษา read-only repository
แต่ยังไม่มีผลวัดเทียบ 4 แบบในรายงานนี้

งานที่ควรเพิ่มก่อนคือ API keys 3 repos แบบส่งมอบครบวงจร, browser UI/landing,
session-token security, money-drift semantics และ interrupted delivery/resume
รายการนี้ยังไม่ได้รัน paid เพิ่มหรือรับรอง fixture ที่ตกหล่นกับ tags ล่าสุด
