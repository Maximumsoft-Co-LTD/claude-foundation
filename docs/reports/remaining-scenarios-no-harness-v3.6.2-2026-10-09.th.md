# Scenario ที่เหลือ: ไม่มี harness เทียบ v3.6.2 — 2026-10-09

[English](remaining-scenarios-no-harness-v3.6.2-2026-10-09.md)

## ขอบเขตและความหมายของผล

ทดสอบครบ 14 งาน legacy ที่ตกหล่น และ API keys แบบ 3 repo ที่สร้าง seed ขึ้นใหม่ แบบละ 1 รอบ ทั้งสองแบบผ่าน acceptance ครบใน 12/15 งาน แต่ **ไม่ใช่ release-green 12/15**: มีสามงานไม่ผ่าน acceptance, API keys ไม่ผ่านเกณฑ์คุณภาพทั้งสองแบบ และ Accumulate ยังมี change เก่าที่ค้าง `proven`

รายงานทดลองนี้เสริม [ผลสิบ scenario ทางการ](scenario-benchmark-no-harness-2026-10-08.th.md) ไม่แทนผลเดิมและไม่เพิ่มงาน legacy เข้า [release matrix](user-scenario-test-plan.md) โดยอัตโนมัติ เริ่มรันวันที่ 8 และเสร็จวันที่ 9 ตุลาคมตามเวลาไทย ใช้ v3.6.2 จาก clean commit `50ad2ce4d5ceccb8bee0c1b8c44d5387617fadec` ทั้งสองแบบตรวจพบ model `claude-sonnet-5-5`, Claude Code 2.1.294 และ Node 26.3.0 ตรวจ source pin และ seed ทุก 34 bundles แล้ว

แบบ direct ไม่มี Change Loop harness ส่วน Change Loop ตั้งเป้าจบ `archived` แล้วตรวจ project tests และ clean-install/retest รัน hidden acceptance นอก consumer ก่อน Land งาน Accumulate เป็นสองคำสั่งต่อกันใน consumer เดิม เก็บรอบซ่อมและ continuation รวมอยู่ใน repeat เดียว

## ผลแยกแต่ละ scenario

direct คือไม่มี harness เวลาเป็นวินาทีในช่วง lab manifest รวม host, oracle, quality และ delivery checks ไม่รวมเตรียม seed/install ค่า CLI รวม final envelopes ที่เก็บได้ทุก continuation เป็นค่าประเมิน ไม่ใช่ใบเรียกเก็บเงินจริง ค่าที่ขาดไม่ใช่ศูนย์

| Scenario | Acceptance direct / v3.6.2 | Seconds direct / v3.6.2 | CLI USD direct / v3.6.2 |
|---|---|---|---|
| 01 Task list | 3/3 / 3/3 | 74.772 / 84.514 | .195159 / .347670 |
| 02 CSV format | 3/3 / 3/3 | 32.744 / 45.024 | .170090 / .309857 |
| 03 Form validator | 5/5 / 5/5 | 31.813 / 52.720 | .173359 / .325768 |
| 04 Paginate | 5/5 / 5/5 | 40.702 / 57.463 | .209470 / .366351 |
| 05 Debounce | 4/4 / 4/4 | 45.013 / 60.150 | .181863 / .352064 |
| 06 Landing site | 5/5 / 5/5 | 79.787 / 105.327 | .326847 / .538581 |
| 07 Session token | 4/5 / 4/5 | 76.454 / 169.944 | .300952 / .509771 |
| 08 Name migration | 4/5 / 4/5 | 36.381 / 108.940 | .200762 / .550358 |
| 09 API compatibility | 4/5 / 4/5 | 54.875 / 103.270 | .220623 / .507921 |
| 10 Rounding fix | 5/5 / 5/5 | 52.812 / 71.264 | .228466 / .371023 |
| 12 Contact search | 5/5 / 5/5 | 36.940 / 77.208 | .189882 / .298647 |
| 13 Money drift | 7/7 / 7/7 | 69.768 / 122.991 | .282102 / .546528 |
| 14 Accumulate: search then sort | 10/10 / 10/10 | 78.628 / 231.582 | .425967 / ≥1.148591 |
| 14b Sort only | 5/5 / 5/5 | 47.055 / 64.998 | .190945 / .369074 |
| API keys: three repositories | 34/34 / 34/34 | 310.597 / 526.129 | 1.164713 / 1.393898 |

งาน direct ที่ส่งมอบสำเร็จทั่วไปมีหลักฐาน tests และ install/retest ส่วน Change Loop จบ `archived` งาน Task list และ direct Accumulate ตรวจการส่งมอบเพิ่มเติมภายหลังโดยไม่ใช้ model งาน token, migration และ API compatibility ยังไม่เสร็จ ส่วน API keys และ Accumulate มีข้อจำกัดเพิ่มตามด้านล่าง

## อัตราส่วนเทียบไม่มี harness

คำนวณเฉพาะเก้าคู่ที่สำเร็จและไม่มีปัญหาการตรวจ/การกู้รอบที่ระบุ: CSV, form validator, paginate, debounce, landing site, rounding, contact search, money drift และ sort-only

เวลารวม direct **436.634 วินาที** เทียบ v3.6.2 **657.145 วินาที** เท่ากับ **1.505 เท่า (+50.5%)** ค่า CLI **$1.9530254** เทียบ **$3.4778924** เท่ากับ **1.781 เท่า (+78.1%)** ทั้งเก้าคู่ที่สังเกตได้ใช้เวลานานและแพงขึ้นเมื่อใช้ harness แต่ n=1, รันพร้อมกันสูงสุดสี่งาน และจุดจบของ workflow ต่างกัน จึงยังสรุป overhead ที่คงที่ คุณภาพที่ดีขึ้น หรือผลจาก skill ใหม่โดยเฉพาะไม่ได้

ไม่นำ Task list ที่แก้ grading server, สามงานที่ไม่ผ่าน, Accumulate ที่แก้ grader/new-intent และ API keys ที่กู้ permission/สร้าง seed/ไม่ผ่าน quality มาคิด performance ratio ตารางยังเก็บเวลาและเงินจริงที่วัดได้ของงานเหล่านี้

## ข้อไม่ผ่านและช่องว่างการส่งมอบ

- **Session token:** direct ใช้ HMAC แต่ไม่มี nonce จึงได้ token เดิมเมื่อ user และเวลาตรงกัน ไม่ผ่าน randomness AC1 ส่วน Change Loop ใช้ token สุ่มแบบ opaque เก็บใน map แต่ไม่ตรงสัญญา signed-token/constant-time เดิม ไม่ผ่าน AC4 ผลนี้ไม่ได้หมายความว่า opaque token ไม่ปลอดภัยโดยตัวมันเอง
- **Name migration:** ทั้งสองแบบรักษาข้อมูลได้ แต่เขียนไฟล์ตรง ไม่มี atomic replacement หรือ backup ไม่ผ่านความปลอดภัยเมื่อถูกขัดจังหวะ AC4
- **API compatibility:** ทั้งสองแบบ throw เมื่อ pagination ไม่ถูกต้อง แทนการคืนผลว่างหรือปรับขอบเขตตามสัญญา ไม่ผ่าน AC5
- **API keys:** สุดท้ายผ่าน 34/34 ทั้งสองแบบ ใช้ gateway root, users submodule และ SDK sibling เป็น Git repo จริง Change Loop จบ archived ผ่าน tests/install/retest ราย repo และตรวจ HEAD/index ทั้งสามไม่เปลี่ยน แต่ handler มี complexity 49, coverage 90.77%, CRAP **50.89** เกินเกณฑ์ ส่วน direct มี complexity 41, coverage 85.71%, CRAP **45.90** ก็ไม่ผ่าน quality เช่นกัน direct ยังมี project test เดิม fail 1/17 เพราะแยก secret แบบ base64url ด้วย underscore ทำให้ assertion ไม่สม่ำเสมอ รันฟรีซ้ำสามครั้งและตรวจราย repo เก้ารายการภายหลังผ่าน แต่ไม่ลบ failure เดิม
- **Accumulate:** acceptance รวม search และ sort ผ่าน 10/10 ทั้งสองแบบ change สุดท้ายของ Change Loop archived แล้ว แต่ sorting attempt เก่าที่ถูกแทนยังค้าง proven เก็บ state ไว้โดยไม่สร้างสิทธิ์ abandon เอง continuation ส่งมอบใช้ model จริง 14 requests ค่าใช้จ่าย **$0.4348036** รวมในยอดแล้ว

Coverage/CRAP เป็นผลจาก collector ไม่ใช่หลักฐานความถูกต้องทาง semantics Task-list ของ Change Loop มี Node coverage ต่ำสุด 0%, เฉลี่ย 65.38% แม้ผ่าน browser acceptance และ CRAP ส่วน Money drift มี coverage ต่ำสุด 50% สำหรับ direct และ 0% สำหรับ Change Loop Landing page ไม่มี numeric coverage/CRAP ที่วัดได้ ฟังก์ชันที่ไม่มี coverage อาจผ่าน collector เพราะ CRAP ต่ำ จึงไม่ใช่ coverage ครบทั้งหมด

## การแก้เครื่องมือทดลองที่เก็บหลักฐานไว้

Task list เคย fail เพราะ server ส่ง MIME ของ `.mjs` ผิด แก้แล้วตรวจ browser ฟรีผ่าน 3/3 Migration ยอมรับ camelCase หรือ snake_case ที่ไม่ทำข้อมูลหาย API pagination ยอมให้คำนวณ `hasMore` จาก metadata Accumulate ตรวจลำดับที่ render และไม่แก้ storage พร้อม mutation ที่ลบ sorting แล้ว tests ต้อง fail ปรับ clock control และ independent probes ของ token ด้วย เก็บ verdict เดิมคู่ผลตรวจใหม่ ไม่แก้ machine-owned proof JSON

Runner ของ Accumulate เดิมตีความคำสั่งงานที่สองเป็นการ resume งานแรกที่ archived แล้ว เก็บ preflight-only bundle ที่ไม่ได้ dispatch model แยกออก จากนั้นใช้ new-intent adapter และมี paid delivery continuation ซึ่งนับค่าใช้จ่ายทั้งหมด

หา source consumer ของ API เดิมไม่พบ จึงสร้าง seed จาก semantic draft 34 claims พร้อมกำหนด entrypoints รอบ direct แรกขาดสิทธิ์ SDK sibling จึงต่อด้วย `--add-dir ../sdk` Git metadata ของ gateway/users ที่ lab ลบไปถูกสร้างใหม่จาก product trees ที่เก็บไว้ ปรับ oracle ให้รับ config shape ภายในและใช้ unknown key รูปแบบถูกต้อง ผลนี้จึงเป็นการทดลอง ไม่ใช่ matched replay ที่ตรึงทุกอย่างของ consumer เดิม

Controls ของ utility/seed, domain และ browser ผ่าน 12, 6 และ 4 รายการตามลำดับ API seed negative control ผ่านเพียง 3/34 ตามคาด แต่ไม่ได้สร้าง positive reference implementation เต็มก่อน paid execution ตรวจ v3.6.2 ฟรีเพิ่มอีกสามชุดผ่าน: installed recovery, large-change packet และ budget continuation แบบไม่มี harness ไม่มีคำสั่ง state เดียวกัน จึงไม่รายงาน deterministic controls ว่าเป็น paid comparative scenarios

## งบและหลักฐานที่บันทึก

ผู้ใช้อนุมัติเพดานใหม่ **$60** มี **34 raw bundles / 38 host sessions / 37 final cost envelopes** ค่า primary host ที่ทราบ **อย่างน้อย $12.3973022** อีกหนึ่ง session ไม่มี final envelope ยังคงเป็น unknown กันสำรองเต็ม stage cap $1.875 ได้ยอดจัดสรรแบบเผื่อ **$14.2723022** ค่า provider/review แยกไม่ได้วัด

สำรองถาวรแบบ private นอก Git และนอก disposable state:

`/Users/hashtagf/.local/share/changeloop/benchmarks/2026-10-09-remaining-no-harness-v3.6.2.tar.gz`

SHA-256: `b3e3fabdb7fe92e3a405b867de884245f3e45e5291d6aac2a4b5a48d6380ea01`

แตก archive แล้วตรวจ hash ครบ **1,692 ไฟล์** ตรงกันทั้งหมด มี companion `.manifest.json` เก็บ hash รายไฟล์ รวม pinned source tar, seeds, prompts, scripts, controls, 34 bundles, streams, patches, proof/state, verdict เดิมและใหม่, supplemental checks และ summary ไม่รวม dependencies/Git metadata หาก replay ต้อง remap absolute paths และติดตั้ง browser dependencies ใหม่ Archive นี้เป็นหลักฐานส่วนตัวในเครื่อง ไม่ใช่ไฟล์เผยแพร่สาธารณะ

อ่านและตรวจผลรอบนี้ได้โดยไม่รัน paid เพิ่ม ก่อน checkpoint รุ่นใหม่ต้องแก้หรือให้ข้อสรุปชัดเจนกับ acceptance, quality, flaky test และ state ที่ค้าง แล้วตรึง grader/seed เก็บหลักฐานใหม่ตาม [ขั้นตอน release](../../RELEASING.md)
