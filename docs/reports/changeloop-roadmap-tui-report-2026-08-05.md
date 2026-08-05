# Changeloop Roadmap and TUI Implementation Report

> วันที่: 2026-08-05 (Asia/Bangkok)  
> โครงการ: `changeloop-cli` (`cloop`)  
> สถานะเอกสาร: implementation audit เสร็จแล้ว; current bounded local gates และ
> composite `test:local-release` ผ่านหลังแก้ false relay overflow, PTY cleanup และ
> background runtime (`test:performance` 17/17); GA gates ภายนอก/ที่ระบุด้านล่าง
> ยังไม่ครบ

## เป้าหมาย

ตรวจ implementation เทียบ roadmap M0–M10 ให้ย้อนกลับไปหา evidence ได้ ศึกษาแนวทาง TUI จาก OpenSpec/OpenCode ใน `/Users/hashtagf/Desktop/Work/kollektiv-agent` ปรับปรุง TUI/runtime ของ `cloop` และแยกสิ่งที่พิสูจน์ได้ใน checkout ออกจาก release/GA gates ภายนอก เอกสารนี้ไม่อ้างว่า roadmap หรือ GA เสร็จครบทั้งหมด

GA (General Availability) คือรุ่นที่ประกาศพร้อมให้ผู้ใช้ทั่วไปใช้งานจริงและต้องผ่าน release gates ทั้งด้านความถูกต้อง ความปลอดภัย performance, compatibility และ supply chain ไม่ได้หมายถึงเพียง “compile ผ่าน” หรือ “feature demo ทำงาน”

## วิธีทดสอบด้วยตนเอง

สร้าง binary จาก repository root ก่อน:

```bash
cargo build --release -p changeloop-cli
export CLOOP_BIN="$PWD/target/release/cloop"
```

จากนั้น smoke test ในพื้นที่ชั่วคราวเพื่อไม่แตะ repository/config จริง:

```bash
export CLOOP_TEST_ROOT="$(mktemp -d)"
export CHANGELOOP_CONFIG_HOME="$CLOOP_TEST_ROOT/config"
mkdir -p "$CLOOP_TEST_ROOT/project"
cd "$CLOOP_TEST_ROOT/project"
git init
"$CLOOP_BIN" --help
"$CLOOP_BIN" doctor
"$CLOOP_BIN" status
"$CLOOP_BIN"
```

ใน TUI ให้ลอง `/status`, `/permissions`, `/jobs`, `/agents`, `/mcp`, `/model`, `/diff`, `/help` และ `/quit` ส่วน provider จริงต้อง setup และ login ผ่าน official provider contract ก่อน:

```bash
"$CLOOP_BIN" setup --provider openai --model <model> --sandbox workspace-write --accept-privacy --accept-provider-data
"$CLOOP_BIN" auth login openai
"$CLOOP_BIN" ask "อธิบายโครงสร้าง repository นี้"
"$CLOOP_BIN" run "ทำการเปลี่ยนแปลงตัวอย่างที่ย้อนกลับได้"
```

คำสั่ง regression หลัก:

```bash
npm run test:local-release
```

สคริปต์ `scripts/verify-local-release.sh` รัน formatting, Rust tests/Clippy,
MSRV contract, oracle/parity/provider corpus, SDK, Foundation, compatibility,
hermetic lifecycle, release policy และ local performance contract ตามลำดับ
แต่ตั้งใจไม่อ้างแทน live-provider, signing/notarization, multi-platform CI หรือ
source-frozen soak 8 ชั่วโมง

ห้ามใช้ `land` เพื่อทดลองแบบสุ่ม เพราะ Land เป็น explicit, transactional authority gate; ควรทดลองใน temporary Git repository และตรวจ `/diff`, proof/review state ก่อนเสมอ

## สรุปผล

ตารางนี้เก็บ source-frozen baseline และผล bounded rerun บน source ปัจจุบันโดยไม่
นำยอดต่างชนิดมาบวกกัน รอบ `test:local-release` แรกพบ relay false failure 16/17:
workload จบ exit 0 และ semantic check ผ่าน แต่ runner buffer stdout ที่ไม่ได้ขอ
capture จนเกิน 64 KiB หลังแก้ให้ discard non-captured stdout ที่ OS boundary และ
แยก three-cycle integration ออกจาก long-run trend claim แล้ว full performance
ผ่าน 17/17 รอบ composite แรกถูกบันทึกเป็น indeterminate เมื่อ PTY ไม่คืน EOF;
หลังแก้ bounded probe cleanup/config isolation แล้ว composite rerun จากต้นจนจบ
คืน exit 0 พร้อม `Local implementation verification: PASS`

| Evidence gate (baseline/current ตามที่ระบุ) | ผล |
|---|---:|
| Rust workspace tests | 726 ผ่าน / 0 ล้ม / 49 suites |
| Current Rust rerun หลัง late hardening | 728 ผ่าน / 0 ล้ม / 49 suites |
| TUI/App-server และ CLI | รวมอยู่ใน workspace 726/726; scoped full/targeted reruns ผ่าน |
| Workspace Clippy `--all-targets -D warnings` | ผ่าน |
| `cargo fmt --all -- --check` / `git diff --check` | ผ่าน / ผ่าน |
| Release `cloop` build | ผ่าน (optimized release) |
| Runtime API oracle | API 12: 9/9; API 13: 9/9 |
| M9 deterministic parity | coverage 47/47; differential 29/29 |
| Provider replay | 28 cases / 14 groups, deterministic 2 runs; Rust corpus test ผ่าน |
| TypeScript SDK → real local app-server | 9/9 |
| Foundation legacy suite | 17 suites, 751 assertions, ALL PASS |
| Local performance contract tests | current 17/17; mixed integration 3 cycles ผ่าน 33/33 workload executions, 0 gaps |
| Repository compatibility (developer mode) | 16 PASS / 3 typed SKIP / 0 FAIL |
| Hermetic lifecycle | 15 transitions ผ่าน; explicit Land จบ exit 0 |
| `cargo audit --deny warnings` | ผ่าน; ไม่พบ blocking advisory |
| `cargo deny` | ผ่าน พร้อม permitted duplicate/license warnings |
| CycloneDX SBOM | generate และ parse validate 22/22 |
| Release automation regression | ผ่าน |

ผลตัวเลขด้านล่างบางส่วนเป็น historical/scoped evidence ระหว่าง development และ
ห้ามนำไปบวกกับยอด final ซ้ำ รายงานแยกให้ชัดเจนระหว่าง:

- สิ่งที่ implement และทดสอบผ่านแล้ว
- สิ่งที่ทดสอบแบบ hermetic/mock เท่านั้น
- release gate ที่ต้องใช้เวลาหรือระบบภายนอก เช่น soak test 8 ชั่วโมง การเซ็น/notarize บน macOS และ live-provider credentials

ผล Rust/Foundation/SDK และ performance เป็น gate แยกกันและไม่ชดเชยกัน แม้
composite local gate ผ่านแล้ว ผล soak diagnostic ก็ยังไม่สามารถใช้รับรอง GA ได้

## งานตาม Roadmap

### M0–M3: Contracts, protocol, storage, projects และ providers

- สร้าง Rust workspace และ contract ภาษา-independent สำหรับ Foundation API 12/13
- เพิ่ม structured message/event, stable cursor, replay, cancellation, crash recovery และ SQLite persistence
- เพิ่ม project-instance lifecycle, config provenance, watcher, lease และ leader locking
- เพิ่ม Anthropic/OpenAI adapters, replay fixtures, safe fallback, accounting และ model catalog
- ทำ tool-result event และ tool execution completion เป็น SQLite transaction เดียว;
  startup integrity ปฏิเสธ dangling/cross-session/nonterminal result และ restart
  interruption จึงไม่สร้างผลซ้ำหรือเหลือสถานะ `running` หลังมี terminal event
- ConfigResolver ปฏิเสธ YOLO จาก project/legacy provenance แบบ fail-closed;
  เฉพาะ user/native CLI/managed policy ที่เชื่อถือได้เท่านั้นที่เสนอ YOLO ได้ และ
  managed policy ยัง downgrade/deny ได้ตาม precedence

### M4–M7: Policy, tools, context, agents และ lifecycle convergence

- เพิ่ม deterministic permissions/AUTO/YOLO boundaries และ provenance labels
- MCP repository transport ไม่ถูก parse/spawn/connect ใน `auto`, `ask`, `deny`
  หรือ `plan` แม้ rule เป็น allow; ต้องมี trusted explicit MCP `allow` และไม่อยู่
  Plan mode ส่วน `/mcp` status ที่ยังไม่ได้รับอนุญาตแสดง typed `disabled` แทนการ
  discovery ที่ก่อ side effect
- เชื่อม patch/shell/test/Git/question tools, owned PTY และ background jobs เข้ากับ agent runtime
- เพิ่ม snapshots/proof-impact tracking และเรียก project formatter หลัง edit
- เพิ่ม project-owned LSP สำหรับ symbol/definition/reference และ freshness diagnostics
- โหลด `AGENTS.md`/task packets แบบ bounded repository-content context ซึ่งไม่สามารถเพิ่ม authority
- รองรับ file/image attachments สูงสุด 16 รายการ/16 MiB พร้อม scope, symlink, secret checks, typed message parts และ CAS artifact references
- แก้ race ที่ background job เคยรายงาน `exited` ก่อน output reader เก็บ stdout/stderr เสร็จ
- เพิ่ม configured auto-repair command แบบ bounded และ targeted re-prove โดยเก็บ fresh receipts ของ provider ที่ไม่ถูก invalidate
- independent review เรียก reviewer child process จาก config ด้วย clean artifact-only packet, typed findings และ time budget 120 วินาที
- เพิ่ม conversation implementation-intent → Draft → explicit confirmation และยืนยันว่า YOLO ไม่ auto-confirm
- เพิ่ม operation-scoped HTTP cancellation registry และแยก control/read paths ออกจาก global service lock
- เปลี่ยน provider adapters/router/runtime ให้ส่ง normalized delta แบบ incremental; SSE เห็น first delta ก่อน upstream complete
- เพิ่ม operation steering ระหว่าง stream, เก็บ partial assistant/reasoning replay, terminalize tool call ที่เริ่มแล้ว และเริ่ม provider turn ใหม่โดยไม่ replay side effects
- จำกัด streaming assembler ตาม output budget (64 KiB–8 MiB และ 1K–65K events); overflow เป็น terminal error และไม่ retry
- `status`/cancel ใช้ control plane โดยตรง ส่วน replay/SSE เปิด SQLite peer จึงตอบได้ระหว่าง provider upstream ค้าง; regression ยืนยันทุก path ตอบภายใน 1 วินาที
- แก้ SSE reconnect ให้ใช้ queue เดียวตลอด connection, frame sequence ไม่ reset ระหว่างหน้า, heartbeat ผูก durable cursor ล่าสุด และไม่สร้าง fake cursor ใน empty session; replay 10,000 events ได้ครบ/ไม่ซ้ำ ขณะที่ pending duplicate set จำกัดตาม queue capacity
- รวม proof/repair/reviewer command execution ไว้ใต้ bounded executor: timeout กำหนดได้, stdout/stderr จำกัด 1 MiB, drain พร้อมกัน และ TERM/KILL ทั้ง Unix process group
- เพิ่ม SQLite schema v3 สำหรับ typed permission/question/doom-loop pauses, single-use responses และ crash recovery ที่ terminalize เป็น `paused_runtime_lost` แทน silent replay
- checkpoint resume ผูกกับ workspace content, tool schema, provider/model; รองรับ Git dirty/untracked ชื่อแปลกและ non-Git tree โดยตัด `.changeloop` owned state ออก
- checkpoint ที่มี sensitive content ถูก persist เฉพาะ redacted non-resumable audit record แล้ว terminalize; ไม่มีการ replay arguments ที่ถูกแก้หรือเก็บ secret ลง SQLite/WAL
- ผูก mutating tool dispatch ทุกครั้งกับ canonical project lease, normalized declared scope และ workspace-content revision; external edit ทำให้ runtime เข้าสู่ durable question pause และไม่เขียนทับ bytes ของผู้ใช้
- harden snapshot restore บน macOS/Linux ด้วย pinned directory fd, `openat`/`mkdirat`/`renameat` และ `O_NOFOLLOW`; preflight ทุก blob ก่อน mutation และ rollback การ restore หลายไฟล์เมื่อ commit กลางทางล้มเหลว
- เพิ่ม `undo_and_save`/`redo_and_save` ให้ย้อน workspace, cursor, redo stack และ
  audit state กลับเมื่อ manifest persistence ล้มเหลวแบบปกติ; process/power crash
  ระหว่าง mutation ยังต้องใช้ prepared journal ตามรายการ GA blocker
- แก้ Land race โดยถือ exclusive project lock ก่อนอ่าน revision, ตรวจ prepared revision และบันทึก observed revision หลัง apply ภายใต้ lock เดียวกัน
- undo/redo ทำให้ receipt ที่ได้รับผลกระทบเป็น `Stale`, ล้าง proof/review readiness แต่เก็บ review-attempt history และกลับ lifecycle ไป Change/build-required
- ย้าย bounded proof/repair/reviewer process runner ไป shared service ที่ CLI และ app-server ใช้ร่วมกัน; `/prove` และ `/review` จึงสร้าง receipt/review artifacts จริงเมื่อมี config และคืน typed unavailable เมื่อไม่มี config
- native provider payload รองรับ Anthropic base64 image และ OpenAI `input_image` โดย resolve bytes จาก CAS เฉพาะตอนส่ง request; checkpoint ที่มี native image ถูก terminalize แบบ non-resumable เพื่อไม่ duplicate base64 ลง storage
- `privacy delete` ใช้ dedicated process lock และ recovery journal, revalidate active/evidence references, purge SQLite/WAL, operational state และ privacy index แบบ idempotent; regression ตรวจว่า prompt ที่ลบแล้วไม่เหลือเป็น raw bytes
- project disposal ผูก cancellation hook ของ model/job/MCP จริงแบบ exactly-once และแยก instance; watcher ไม่ติดตาม DB/WAL/lock ภายใน, หยุดที่ nested Git boundary และ invalidate config/MCP เฉพาะ path ที่เกี่ยวข้อง
- config resolver ปฏิเสธ layer ที่ source/order ซ้ำ, hot reload แยก safe/restart-impact แบบ atomic และ legacy warning แสดงเฉพาะเมื่อมี `FOUNDATION_*` จริง

### M8–M10: TUI/server, parity, MCP และ release

- เพิ่ม headless/stdio/Unix socket/HTTP+SSE surfaces และ TypeScript SDK
- เพิ่ม M9 parity suite, migration compatibility และ deterministic oracle
- เพิ่ม MCP transports/OAuth controls, release workflows, SBOM และ signed-update verification path
- release archive มี compatibility launcher `claude-foundation` ที่ส่งต่อ argument ไปยัง `cloop`; artifact verifier บังคับให้ทั้งสอง executable อยู่ใน archive
- harden release verifier ให้เทียบ checksum manifest กับ archive set แบบ exact, ปฏิเสธ traversal/link/non-regular/missing-exec และปฏิเสธ symlink update target
- ทำ deterministic tar ให้เหมือนกันบน macOS/Linux, ตรวจ cosign signature ทันที และ normalize archive หลัง notarization
- ปรับ TUI เป็น responsive header/transcript/status/composer, จำกัด scrollback 256 cards และ history 100 prompts
- เพิ่ม Unicode-safe editor, PgUp/PgDn, history/word editing, terminal-control sanitization และ modal state views
- wire TUI commands ทั้งหมดเป็น typed app-server RPC; diff และ snapshot undo/redo ใช้งาน implementation จริง
- `/prove` และ `/review` แสดง blocked state ตามจริงเมื่อไม่มี proof/reviewer service แทนการรายงานความสำเร็จเทียม
- เปลี่ยนจาก redraw ทั้งหน้าทุก 50 ms เป็น dirty-only redraw พร้อม Resize invalidation และ coalesce burst ที่กรอบไม่เกินประมาณ 60 FPS; idle blocking poll ลดจาก 20 เป็น 4 wakeups/วินาที ขณะที่ background operation ยังคงตรวจผลทุก 50 ms
- เพิ่ม semantic boot/status markers และ PTY regression ที่ต้องเห็น `/status`, `"ready":true`, ส่ง `/quit` และ exit 0
- เพิ่ม durable draft discard; Esc บน confirmation ลบ draft แบบ atomic และเขียน `draft_discarded` audit event แทนการซ่อน dialog แต่ทิ้ง draft ค้าง
- ปรับ CLI ให้ `prove [change]`/`review [change]` เลือก change ล่าสุดที่ยังไม่ Land ได้ และแยก proof-failure exit code 5
- `privacy export|delete` รองรับ session แบบ optional; bulk delete ลบเฉพาะข้อมูลที่ inactive/unreferenced
- `mcp extensions` และ status แสดง discovery failure แบบ isolated พร้อมสถานะ loader ตามจริง
- extension `stdio-v1` ต้องผ่าน OS sandbox, deny network/home credentials, cleared environment, bounded/sanitized output และ Unix process-group cleanup; platform sandbox ใช้ไม่ได้แล้ว execution ต้องถูกปฏิเสธ
- RuntimeTools แสดง extension เฉพาะ manifest ที่ประกาศ runtime ชัดเจนและยังต้องผ่าน MCP permission; forbidden Land/scope/permission/policy outputs ถูก block
- เพิ่ม maturity labels ใน TypeScript SDK และ doctor แสดง keyboard/headless accessibility capabilities
- เพิ่ม public `change discard`, ปรับ error-to-exit-code ของ headless control, แสดง provider/model onboarding ใน `status`/`models` และไม่เปิด TTY prompt เมื่อชื่อ auth provider ไม่ถูกต้อง
- เชื่อม tagged-release workflow กับ Ed25519 release/channel manifests ที่ CLI อ่านได้โดยตรง พร้อม fail-closed signing configuration, GitHub OIDC/cosign checksum signatures และ tamper/downgrade integration tests
- ยกระดับ signed release/channel manifest เป็น schema v2 ที่ผูก `targetTriple` และ `artifactKind=standalone-executable`; v1 fail-closed, wrong-platform ถูกปฏิเสธก่อนเปิด artifact/สร้าง sidecar, ตรวจ ELF/Mach-O architecture และ rollback เมื่อ post-install hash ไม่ตรง ทั้งนี้การ execute บนสี่ target และ publication จริงยังเป็น external gate
- เพิ่ม `/sessions` และ keyboard selectors สำหรับ session/model/job/agent โดยแยก selected session ออกจาก active change, model selection ต้องยืนยันและ restart, ส่วน job/agent cancellation ต้องยืนยันผ่าน typed RPC
- เพิ่ม first-run TUI wizard (F2 หรือ `/setup`) สำหรับ provider → model → sandbox → privacy/provider-data confirmation โดยไม่รับ credential และเขียน config แบบ atomic
- เพิ่ม grapheme-aware editor, bounded paste 65,536 graphemes, bracketed-paste cleanup, Ctrl-C escalation และ terminal-mode RAII; stress 10,000 transcript events ยังคงเหลือเพียง 256 cards
- composer ใช้ cursor-aware single-row viewport ที่กันพื้นที่ cursor และคำนวณความกว้างตาม Unicode grapheme จึงไม่ตัดภาษาไทย/family emoji กลาง cluster และไม่ปล่อย cursor หลุดขอบเมื่อ prompt ยาวหรือ terminal แคบ
- เพิ่ม Unix signal guard สำหรับ `SIGINT`/`SIGTERM`/`SIGHUP`; PTY probe ส่ง `SIGTERM` จริงแล้วตรวจว่า exit 0, termios กลับค่าเดิม และมีทั้ง bracketed-paste enable/disable sequence ส่วน panic ใช้ `TuiTerminalMode::Drop` ภายใต้ Rust unwind profile เดิม จึงผ่าน cleanup path เดียวกัน
- แก้ PTY probes ที่เคย `waitpid(..., 0)` ไม่จำกัดและถือ PTY master ค้าง:
  ใช้ shared bounded `WNOHANG` TERM→KILL→reap, ปิด PTY ก่อน reap, isolate ทั้ง
  `CHANGELOOP_CONFIG_HOME`/`XDG_CONFIG_HOME` และ normalize incremental CSI stream;
  cleanup/ANSI tests 3/3 และ hostile-env selectors/robustness ไม่มี survivor
- เปลี่ยน TUI background Tokio runtime จาก current-thread เป็น multi-thread 1 worker
  ให้เข้ากับ `block_in_place`; ปิด panic ใน prove/review และ semantic cancellation
  ผ่านที่ 124.38/174.454 ms พร้อม clean exit
- เพิ่ม `NO_COLOR` path ที่คง ANSI transport สำหรับ cursor/layout แต่ map สีจริงทั้งหมดเป็น terminal default; selected row ใช้ reverse+bold และ phase มีข้อความ `READY/RUNNING/BLOCKED/FAILED` เสมอจึงไม่อาศัยสีอย่างเดียว
- `TERM=dumb` และ non-TTY ถูกปฏิเสธก่อนเปิด project/runtime พร้อม exit 2 และคำแนะนำ `cloop ask`/`cloop status`; แก้ defect ที่เดิม non-TTY พิมพ์ error แล้ว process ค้างเพราะ service ถูกเปิดก่อน capability check
- ขยาย `/help` ให้ครบทุก roadmap command และ shortcut ที่ implement จริง ได้แก่ F2, cursor/history, Ctrl-A/E/W, PgUp/PgDn, Ctrl-C, Esc และ selector navigation
- เพิ่ม hermetic black-box lifecycle sample ใน temporary Git repo: conversation read-only → draft/contract/confirm → proof/review → undo stale → redo/reprove/review → explicit Land รวม 15 transitions โดย debug fixture ต้องมีทั้ง env opt-in และ project marker และเปิดไม่ได้ใน release build
- เพิ่ม versioned skill/hook v1; hooks ต้อง subscribe lifecycle event และต้องได้ trusted MCP `allow` ชัดเจน, เป็น advisory/untrusted, crash/timeout แยกจากกันและไม่สามารถ veto/advance/grant/Land หรือข้าม Proof/Review

## งานวิจัย TUI จาก OpenSpec/OpenCode

ตรวจอ่าน implementation ใน `kollektiv-agent/packages/opencode` โดยเน้น startup, runtime queue/lifecycle, scrollback และ footer views แนวทางที่นำมาปรับใช้ประกอบด้วย:

- startup-sensitive lazy loading และการ resolve boot dependencies แบบพร้อมกัน
- serial prompt queue และ bounded event/history buffers
- แยก transcript/scrollback ออกจาก composer/footer
- status ที่แสดง phase, model, usage และ shortcut อย่างคงที่
- permission/question/subagent views และ selector surfaces
- resize/replay, reconnect semantics และ scoped shutdown cleanup
- Ctrl-C แบบเป็นลำดับ: ล้าง prompt → cancel operation → ออกจากโปรแกรม

ไม่ได้คัดลอกโค้ดจาก repository ต้นแบบ แต่ปรับแนวคิดให้เข้ากับ Rust/Ratatui และ lifecycle contract ของ Changeloop

## ผลทดสอบ

### Historical baseline ก่อน TUI/runtime merge รอบสุดท้าย (ไม่ใช่ final gate)

| ชุดทดสอบ | ผล |
|---|---:|
| Rust workspace ณ baseline เดิม | 326 tests ผ่าน, 47 suites |
| `cargo fmt --all -- --check` | ผ่าน |
| `cargo clippy --workspace --all-targets -- -D warnings` | ผ่าน |
| API12 oracle | 9/9 ผ่าน |
| API13 oracle | 9/9 ผ่าน |
| M9 parity coverage | 47/47; cases 29/29 ผ่าน |
| Provider replay corpus | 28 fixtures / 14 groups ผ่าน |
| TypeScript SDK | 4/4 ผ่าน รวม real local server exercise |
| Performance integration | 2/2 ผ่าน |
| TUI/App-server scoped | 39 ผ่าน |
| Runtime-tool wiring scoped | 64 ผ่านใน 6 suites |
| Security regression (tools/language/app-server) | 65 ผ่านใน 6 suites |
| Snapshot scoped | 7 ผ่าน |
| Policy scoped | 11 ผ่าน |
| Foundation legacy full suite | ALL SUITES PASS (มี soft-budget/submodule warnings) |
| TUI PTY regression | formal p95 606.61 ms; standalone 30/30 p95 731.75 ms |
| Convergence/concurrency/bounded executor | 94 ผ่านใน 10 suites |
| Manual `cloop --help` / `doctor` / `status` smoke | ผ่าน; local telemetry defaults และ read-only conversation boundary แสดงถูกต้อง |
| SSE concurrency stress | พบ connection reset 1 ครั้งในการรันแรก; isolated/full rerun และ stress ต่อเนื่อง 25/25 ผ่าน |

### Performance diagnostic

ตารางนี้อัปเดตจาก local smoke record ล่าสุด
`target/performance/local-gaps-smoke.json` ซึ่งเป็น `diagnostic-smoke` ระหว่าง
source ยังเปลี่ยนอยู่ (`integrity.unchanged=false`) ใช้ repetition ต่ำกว่าระดับ
release และไม่ใช่ source-frozen/reference-machine evidence

| Gate | ผล |
|---|---:|
| CLI help p95 | 3.965 ms (2 repetitions, 1 warmup) |
| CLI status p95 | 4.337 ms (2 repetitions, 1 warmup) |
| TUI ready p95 | 53.872 ms (2 repetitions, 1 warmup) |
| Replay 10,000 events | cold 48.658 ms / RSS growth 5,984 KiB; warm 46.299 ms / 5,616 KiB (1 repetition/variant) |
| stdio relay p95 | idle 2.770 ms; 4-instance steady 3.745 ms |
| Unix socket relay p95 | idle 3.207 ms; 4-instance steady 9.062 ms |
| HTTP-SSE relay p95 | idle 3.305 ms; 4-instance steady 10.015 ms |
| Provider router overhead (historical captured record) | 0.216% aggregate; ณ เวลาที่ capture มี 8 streaming cases และ 2 native non-streaming cases ยัง unsupported |
| Graceful shutdown | ทุก 6 states terminal, forced cleanup 0; ช้าที่สุด LSP 5.332 ms (1 repetition/state) |

event relay แต่ละ transport/variant มีจำนวนและลำดับครบ 10,000 รายการโดยไม่พบ
drop, วัด queue depth/capacity 1,000 และเห็น fail-closed backpressure จริง
direct/routed provider events ของ 8 streaming cases เทียบเท่ากัน แต่ ณ เวลา
capture นั้น native non-streaming cases ยังไม่มี adapter contract การวัด soak ใน record นี้เป็น
diagnostic 1 วินาที ไม่ใช่ release evidence 8 ชั่วโมง จึงยังไม่ถือว่า
performance GA gate ครบ รายละเอียด promotion rule อยู่ที่
`docs/reports/initial-performance-evidence-matrix.md`

ข้อจำกัด native non-streaming ในย่อหน้าก่อนเป็นข้อมูลของ record เก่าขณะ capture
เท่านั้น หลังจากนั้นได้เพิ่ม parser/fixture แบบ SHA-pinned สำหรับ Anthropic และ
OpenAI ทั้ง success/error แล้ว แต่ยังคงเป็น synthetic/hermetic evidence ไม่ใช่
live-provider proof

### TUI robustness และ hermetic lifecycle รอบล่าสุด

เพิ่ม unified release-grade diagnostic producer `scripts/performance/tui_evidence.py`, JSON Schema และ assessor แยก process ซึ่ง fail-closed เมื่อ case หาย, JSON partial, timeout/nonzero exit, source/binary เปลี่ยนระหว่าง capture หรือ hash ปัจจุบันไม่ตรง record พร้อม mutation tests 4/4 สำหรับ assessor

ผล capture จาก release binary `target/release/cloop` SHA-256 `ce0cdf7ca878b15b6ed736b01134332837f308b02e9b2e01438090a89bbc5326`:

| Case | ผล diagnostic |
|---|---:|
| Startup → `/status` ready → `/quit` | 48.855, 55.738, 55.127 ms; 3/3 ผ่าน |
| Resize/slow reader/Unicode/Ctrl-C | resize 500 ครั้ง, slow reader 200 ms, Thai/family emoji และ exit 0 ผ่าน |
| Idle + SIGTERM cleanup | wall 1,010.045 ms, process CPU รวม startup 7.939 ms, termios/bracketed paste restore ผ่าน |
| `NO_COLOR` | boot/quit exit 0, ไม่มี foreground/background color SGR |
| `TERM=dumb` และ non-TTY | fail-fast exit 2 พร้อม headless guidance |
| Transcript burst | deterministic 100,000 events, retain 256 cards ผ่าน |
| Real provider SSE → PTY 10k deltas | BLOCKED แบบ fail-closed: release binary ไม่มี trusted literal-loopback provider endpoint contract; fixture รับ 0 requests และไม่ได้เปิด external network/credential |

JSON Schema ยอมรับ failure record ครบถ้วน, assessor ปฏิเสธ record ด้วย exit 1 ตามตั้งใจ และ fail-closed mutation tests ผ่าน 4/4 Record อยู่ที่ `docs/reports/tui-evidence-diagnostic-2026-08-05.json` โดยมี `diagnosticPassed=false` และ `releaseEligible=false` เพราะ real provider-stream case ยังไม่สามารถรันอย่าง hermetic และยังไม่ได้ทำ release-machine repetition/8-hour soak

เพิ่ม loopback OpenAI Responses SSE fixture ที่ bind เฉพาะ `127.0.0.1` และเตรียม 10,000 `response.output_text.delta` events แต่ preflight พบว่า release `ProviderBackend` สร้าง default adapter โดยไม่มี config/env contract สำหรับ override endpoint ไป literal loopback การเรียก `ask` ต่อจะส่งไป provider จริง จึงตั้งใจไม่เปิด process, ไม่โหลด credential, ไม่ยิง external network และคืน typed unsupported exit 3 การปิด gap นี้ต้องเพิ่ม trusted policy/config contract ใน runtime ก่อน จึงไม่แก้ผ่าน proxy/MITM/DNS override

capture รอบแรกถูก assessor ปฏิเสธตามตั้งใจเมื่อ shared source และ debug binary ถูก rebuild ระหว่าง/หลัง capture; รอบ release ถัดมายืนยัน integrity ก่อน/หลังไม่เปลี่ยนและ baseline cases ผ่านทั้งหมด ก่อนขยาย assessor ด้วย provider-stream requirement ซึ่งทำให้ final record ถูกปฏิเสธด้วยเหตุ capability gap ข้างต้น ไม่ใช่ integrity drift

- typed selectors สำหรับ session/model/job/agent ใช้คีย์บอร์ดได้จริง; session selection แยกจาก `active_change`, model selection persist เฉพาะ model ใน configured catalog พร้อม restart confirmation และ job/agent cancellation ต้องยืนยันก่อน
- first-run wizard แบบ local-only ครบ provider → model → sandbox → privacy/provider-data disclosure; PTY accept/cancel ผ่านและ assert disk state ใน temporary config
- transcript stress 10,000 events ยังคง bounded ที่ 256 cards; card 64 KiB, selector 200 options/4 KiB detail, prompt 65,536 graphemes/1 MiB
- grapheme-aware edit/cursor, bracketed Unicode paste, control sanitization และ Ctrl-C escalation `clear → cancel → exit`
- PTY robustness ผ่าน 5/5 รอบ: resize 500 ครั้ง, slow-reader 200 ms, ภาษาไทย/family emoji paste, status หลัง paste และ clean Ctrl-C exit
- provider/run/proof/review ย้ายเป็น owned background operation พร้อม bounded result queue ขนาด 1; cooperative backends/fixtures join ครบทุก success/error/drop และ cancellable process group โดย blocked proof ยกเลิก 112 ms และ blocked reviewer 166 ms ก่อน clean exit ใน PTY regression แต่ permanently unresponsive in-process backend ยังเป็น gap ที่ระบุด้านล่าง
- isolated debug ready probe ผ่าน 30/30; p95 ประมาณ 47.83 ms บน temporary empty project (ไม่ใช้แทน release-machine measurement เดิม)
- hermetic black-box lifecycle ผ่าน: conversation exit 0, draft exit 0, contract-required exit 3, stale Land exit 8 และ explicit Land exit 0; ครอบคลุม low auto-proof, risk review, undo/redo invalidation และ re-prove/re-review
- historical scoped gate รอบนั้น 130 tests ใน 8 suites ผ่าน และ Clippy `-D warnings` ผ่าน
- app-server transport security audit ปิด request smuggling/header ambiguity ด้วย strict HTTP/1.1 parser, ปฏิเสธ duplicate headers/`Transfer-Encoding`/cursor ซ้ำ, จำกัด header 16 KiB และ JSONL 1 MiB, ใช้ read timeout สำหรับ slowloris และตรวจ SSE cursor ก่อนส่ง `200 OK`
- Unix socket ปฏิเสธ path ที่เป็น regular file/symlink, ลบเฉพาะ stale socket ที่พิสูจน์แล้ว, ตั้ง permission `0600`, บังคับ token, ปิดทันทีเมื่อ auth ผิด, จำกัด 256 requests ต่อ connection และ cleanup socket ทุก error path; historical app-server adversarial/unit snapshot 78/78 ผ่านและ Clippy `-D warnings` ผ่าน
- TypeScript SDK audit แก้ protocol/API drift: ตรวจ protocol+maturity ทุก RPC/SSE response, token เป็น private, endpoint/origin/control input fail-fast, จำกัด response/SSE frame 1 MiB, validate frame/session/sequence, suppress cursor boundary replay, typed backpressure และเพิ่ม operation-scoped cancel/steer; real `cloop serve --http` exercises รวม auth/origin, replay, heartbeat และ cancellation ผ่าน 7/7
- onboarding/update/completion black-box audit ใช้ `CHANGELOOP_CONFIG_HOME` และ data path ชั่วคราวทั้งหมด: invalid setup/auth ไม่เขียน partial config, setup/models/status สอดคล้องกัน, bash/zsh/fish completion ครบ nested commands/options และ syntax-check shell ที่ติดตั้ง, migration digest/recovery guards, signed update check/install/interrupted recovery และ `claude-foundation` alias ถูก exercise ผ่าน CLI จริง
- historical scoped ops+CLI user-journey snapshot 67 tests ใน 6 suites ผ่าน; SDK real-server gate 7/7 และ protocol 27/27 ผ่าน
- self-update filesystem hardening บน Unix ใช้ pinned dirfd + `openat`/`fstatat`/`renameat`/`unlinkat` และ `O_NOFOLLOW`; ปฏิเสธ parent swap, symlink/hardlink, owner/link-count/type/mode ผิดสำหรับ target/stage/backup/journal/lock, serialize apply/recover ด้วย directory-inode lock และ owner-only sidecar lock, รักษา file→journal→directory fsync ordering พร้อม portable fallback diagnostic ใน `cloop doctor`; ops adversarial/unit tests 24/24 และ Clippy ผ่าน
- implicit self-update ปฏิเสธ Homebrew/Cargo/npm-managed executable พร้อม manager-specific recovery command และยอม direct replace เฉพาะ standalone; explicit `--target` ยังคงผ่าน filesystem guards เดิม โดย historical CLI snapshot 46/46 ใน 4 suites และ Clippy ผ่าน
- MCP OAuth security audit บังคับ authorization/token/revocation endpoint เป็น HTTPS (ยกเว้น loopback-IP สำหรับ hermetic test), callback เป็น exact `127.0.0.1`/`::1` พร้อม port และ `/callback`, PKCE S256 + state entropy สูง, strict Host/state/duplicate-query validation, redirect/cookie disabled, response/content-type/timeout 64 KiB bounds และ bearer-only token validation
- credential lifecycle ไม่เขียน token ลง registry/config/output, redacts authorization code/verifier/access/refresh token จาก `Debug`, zeroize secret buffers/objects เมื่อ drop, preserve rotated refresh token และใช้ keyring replacement ที่ rollback credential เดิมเมื่อ write ล้มเหลว; logout ลบ local credential แม้ remote revoke ล้มเหลวโดยยังส่ง typed error กลับ
- historical MCP OAuth adversarial/unit snapshot 28/28 ผ่านและ Clippy `-D warnings` ผ่าน; provider HTTP ใช้ hermetic loopback fixtures เท่านั้น ไม่ใช้ credential/network จริง ส่วน credential rollback/update suite ผ่าน 27/27 และ CLI callback/security suite ผ่าน 31/31; ops Clippy ผ่านใน snapshot เดียวกัน
- M10 MCP bounded-runtime audit เพิ่ม streaming response cap 16 MiB, strict secure endpoint validation ที่ transport boundary, exact JSON-RPC version/request ID matching, stdio process-group cancellation และ deterministic connection/tool/resource/argument bounds; MCP output ทุกชิ้นถูกบังคับเป็น untrusted `mcp-content` provenance
- OAuth รอบสุดท้ายตรวจ PKCE challenge ซ้ำก่อนแลก token, แยก strict token/revocation endpoint contract (ไม่มี query/userinfo/fragment), validate token ทุกครั้งก่อน/หลัง keyring load/replace, rollback เมื่อ replacement ล้มเหลว และยังลบ local credential เมื่อ remote revoke ล้มเหลว; extension manifests/entries ใช้ no-follow regular single-link project scope พร้อม input/output/time/count bounds และเก็บ failed health record เมื่อ cleanup ล้มเหลว
- exact scoped verification หลังแก้ M10 ผ่าน: `cargo test -p changeloop-mcp` 35/35, `cargo clippy -p changeloop-mcp --all-targets -- -D warnings`, scoped `cargo fmt --check` และ `git diff --check`; ไม่ได้ใช้ผลนี้แทน full-workspace หรือ 8-hour GA soak evidence
- public CLI contract audit เพิ่ม fail-closed bounds: ไม่เกิน 64 argv, argument/prompt ไม่เกิน 1 MiB, public ID 1–256 ASCII-safe bytes, path 16 KiB, model/provider/config field validation และปฏิเสธ control characters/empty prompt ก่อนเปิด provider หรือเขียน state; reordered/ambiguous options จบด้วย exit 2 โดยไม่เขียน partial config
- bounded CLI/ops audit รอบล่าสุดเพิ่ม argv aggregate cap 16 MiB และ fail-fast ระหว่าง collect; first-run setup ถูก revalidate หลัง deserialize, auth registry revalidate provider allowlist ก่อนเรียก keyring และ credential จำกัด 64 KiB/no-control ก่อน mutation
- privacy purge journal รุ่นใหม่ผูก exact requested session, จำกัด/ตรวจ unique safe IDs, re-check active/evidence guard ทุก recovery และ fsync directory; legacy journal ใช้ได้เฉพาะเมื่อ single-session scope ตรงกัน จึงไม่สามารถใช้ repository-authored journal ขยาย `privacy delete <id>` ไปยัง session อื่น ส่วน migration ปฏิเสธ symlinked `.changeloop` ก่อนสร้าง lock/stage และใช้ no-follow single-link lock
- `config explain` มี black-box provenance/precedence regression ยืนยัน defaults → user → project → native environment, เลือก effective source/value ถูกต้อง, ส่ง JSON value เดียว และ path-like field ที่ไม่ถูกต้องจบด้วย exit 2 โดยไม่มี stdout
- signed update catalog เพิ่มเพดาน 10,000 releases/16 KiB ต่อ source; online source ต้องเป็น parsed HTTPS ที่ไม่มี userinfo/fragment และ offline source ต้องไม่ใช่ URL ผล exact scoped gate: CLI+ops 109/109 ผ่าน, Clippy `--no-deps -D warnings`, scoped fmt และ `git diff --check` ผ่าน; full dependency Clippy รอบเดียวกันถูกขวางด้วย dead-code 3 จุดใน app-server ที่อยู่นอก audit นี้ จึงไม่รายงานเป็น full-workspace Clippy pass
- stderr boundary แปลง error เป็นบรรทัดเดียว bounded 4,096 characters และ redact `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/server token; structured read commands ถูก black-box assert ว่ามี JSON value เดียวโดยไม่มี trailing output พร้อมตรวจ unknown-command help และ exit codes
- แก้ defect optional `resume`/change selection ที่เดิมเลือก BTree key ตามตัวอักษร ไม่ใช่รายการล่าสุด ให้เลือก `created_at_ms` แบบ deterministic; เพิ่ม Unicode/boundary/adversarial tests และเอา production `unwrap`/`expect` ใน CLI JSON/digest/journal-parent paths ออกเป็น typed exit 2/4
- จาก OpenSpec/OpenCode TUI pattern เรื่อง searchable recent selectors ปรับ selector ของ cloop ให้ค้น label/detail แบบ Unicode ได้, query bounded 256 bytes, keyboard Home/End/PgUp/PgDn/Backspace/Ctrl-U, แสดงตำแหน่ง/จำนวน และทำ viewport window ตามความสูง terminal ทำให้ selection ลำดับท้ายจาก 200 รายการไม่หายพ้นจอ; scoped regressions ผ่านในแต่ละรอบ แต่ยอดรวม final รอ source-frozen run
- เพิ่ม fail-closed non-UTF-8 boundary: เปลี่ยน `env::args`/`env::vars` ที่ panic ได้เป็น `args_os` พร้อม typed exit 2 และ `vars_os` ที่ข้าม unrelated invalid entries; MCP HTTP registry ไม่รับ insecure URL/userinfo/query/fragment และ auth/update/MCP mutation responses เป็น JSON value เดียวโดยไม่สะท้อน credential-bearing URL
- selector ที่ filter แล้วไม่พบผลลัพธ์จะไม่ปิดเงียบเมื่อกด Enter แต่คงหน้าต่างพร้อมสถานะชัดเจน; onboarding/model RPC ใช้ validation เดียวกันและปฏิเสธ empty/whitespace/control/เกิน 256 bytes ก่อน disclosure/save รวมทั้งเพิ่ม tiny-terminal render matrix 1×1 ถึง 120×40
- restart audit ไม่เชื่อ repository artifact เป็น lifecycle authority: `/change` scan สูงสุด 1,000 entries/คืนไม่เกิน 200 candidates, รับเฉพาะ regular non-symlink artifact ไม่เกิน 1 MiB ที่มี session จริงใน SQLite, ตรวจ proof revision เทียบ workspace ปัจจุบัน และนับ review ว่าผ่านเฉพาะเมื่อ `evidence.json` ผูกกับ proof revision เดียวกัน; คืน root/phase/proof/review พร้อม high-risk floor และต้องระบุ change ID เอง
- restart fresh/stale และ symlink adversarial regressions ผ่าน isolated 2/2; historical App-server rerun ครอบคลุม tiny/rapid resize matrix `1×1`, `8×3`, `20×6`, `40×10`, `120×40`, Unicode prompt viewport, 100,000-event transcript compaction และ deterministic 64-job ordering regression; ยอดรวม final รอ source-frozen run
- PTY signal/idle probe ผ่าน 5/5; หลัง idle ประมาณ 1 วินาที process CPU รวม startup อยู่ที่ 10.525–20.661 ms ซึ่งต่ำกว่า conservative threshold 100 ms ทุกครั้ง และ resize-storm 500 events + slow-reader + Unicode paste regression ผ่านหลังเพิ่ม frame coalescing
- portability probe ผ่าน: non-TTY และ `TERM=dumb` จบด้วย typed guidance โดยไม่ค้าง; `NO_COLOR=1` boot/quit exit 0 และ captured output 1,956 bytes ไม่มี ANSI foreground/background color SGR ขณะที่ยัง render เนื้อหา TUI ได้
- operational authority boundary อ่าน `.changeloop/operational.json` แบบ regular non-symlink สูงสุด 16 MiB และ proof-provider/reviewer config สูงสุด 1 MiB ด้วย `O_NOFOLLOW` บน Unix; ปฏิเสธ symlink/hardlink/inode swap/FIFO/sparse oversized ก่อน parse, copy clean-review ผูก parent identity และ proof state commit หลัง durable audit; ฝั่ง app เขียน proof JSON เป็น commit marker สุดท้ายก่อนเปลี่ยน in-memory state
- persistent-state hardening เพิ่ม setup/privacy/migration journal reader แบบ bounded `O_NOFOLLOW` และปฏิเสธ hardlink, เปลี่ยน writer เป็น unique `create_new` staging mode `0600`, ตรวจ parent canonical/dev+ino ซ้ำก่อน rename และ `fsync` directory; MCP registry ใช้เพดานอ่าน/เขียนเดียวกัน 1 MiB, ปฏิเสธ symlinked `.changeloop`, mode `0600` และ sync directory ส่วน operational state sync directory หลัง atomic persist
- auth profile registry (เก็บเฉพาะ provider ID ไม่เก็บ credential) ใช้ bounded 64 KiB `O_NOFOLLOW` regular/single-link reads, unique owner-only staging, parent identity recheck, atomic rename และ file/directory `fsync`; predictable-stage symlink ไม่ทำให้ victim ถูกแตะ ส่วน symlinked parent, hardlink และ sparse oversized registry ถูกปฏิเสธพร้อม rollback keyring mutation
- SQLite storage เปิด diagnose/runtime ด้วย `SQLITE_OPEN_NOFOLLOW`, ใช้ canonical parent ที่ตรวจ canonical/dev+ino ก่อนและหลัง open/initialize และปฏิเสธ database/WAL/SHM ที่เป็น symlink, non-regular หรือ multi-hardlink; quota sidecar accounting ไม่ตาม symlink และรองรับ non-UTF-8 path โดยไม่ประกอบชื่อผ่าน lossy display ทั้งนี้ standard SQLite VFS ยังมี TOCTOU window แคบระหว่าง path validation กับ internal open ซึ่งตรวจย้อนหลังได้แต่ปิดแบบ atomic ไม่ได้หากไม่สร้าง custom VFS/dirfd integration
- transactional Land hardening บังคับ change/transaction ID เป็น safe component, ปฏิเสธ symlinked target/sandbox root และ projected/journal/archive file ที่เป็น symlink/non-regular/multi-hardlink, เปิดด้วย `O_NOFOLLOW`, copy ผ่าน opened handle ไป unique synced stage, bind restored authority/expected revision/backup slot กับ plan และเขียน journal/archive แบบ bounded `0600` + parent identity recheck + atomic rename + directory `fsync`; external divergence ยังคง fail เป็น conflict/manual recovery โดยไม่เขียนทับเงียบ ทั้งนี้ same-user target edit ในช่วงแคบระหว่าง final hash check กับ rename ไม่มี portable compare-by-hash primitive จึงตรวจหลังเขียนและ rollback แทน
- M1 structured-message audit เพิ่ม pre-parse envelope cap 16 MiB, message/part ID 256-byte non-empty/no-control bounds, duplicate part/compaction ID และ envelope-session mismatch rejection, known schema/part-state/artifact SHA/inline-or-artifact invariants พร้อม terminal transition validator; unknown parts preserve แบบ opaque เฉพาะ negotiated minor mismatch และยังถูก size bound, provider reasoning/compaction metadata คง replay signature แต่ redact credential fields ก่อนคืน decoded event และ storage boundary ยัง redact ซ้ำ ส่วน runtime interruption suite ยืนยัน pending tool call จบด้วย terminal error `ToolResult`; restored session shape ปฏิเสธ conversation ที่มี change state, change ที่ไม่มี state และ invalid session ID
- state restore เรียก `ConvergenceHarness::validate_restored()` ทุก change ก่อนคำสั่งใดใช้ proof/review/Land authority; regression ปลอม requirements ว่างถูก reject และเอา remaining parent-path `expect` ใน atomic private JSON writer ออก
- app-server child merge ใช้ porcelain-v1 `-z` parser แบบ byte-safe, ตรวจทั้งสองฝั่งของ rename/copy กับ scope/attribution, รองรับ delete/rename/space/newline, preload และ bound ทุก source/patch ก่อน mutation, ใช้ lease-checked anchored deletion และ rollback snapshot เมื่อ multi-file merge ล้มกลางทาง; raw non-UTF-8 ถูกปฏิเสธโดยไม่แตะ parent เพราะ public child-result path schema ยังเป็น `String` ส่วน durable proof discovery อ่านผ่าน bounded `O_NOFOLLOW` helper เดียวกันเพื่อปิด metadata/read TOCTOU บน Unix
- post-write/apply-patch SHA เปลี่ยนจากโหลดไฟล์ทั้งหมดเข้า memory เป็น streaming hash จาก regular `O_NOFOLLOW` handle และ fixture append ถูกจำกัด 1 MiB; sparse/symlink regressions ผ่านและ scoped App-server Clippy สะอาด
- CLI update/channel manifests จำกัด 16 MiB ส่วน privacy journal, native config และ MCP registry จำกัด 1 MiB; legacy JSON ใช้เพดาน 16 MiB ทั้งหมดต้องเป็น regular non-symlink และตรวจซ้ำจาก opened handle
- Git subprocess สำหรับ workspace revision, independent-review diff และ Land path enumeration ใช้ bounded executor พร้อม timeout/process-group cleanup; truncated output fail-closed และ workspace file hashing เปลี่ยนเป็น streaming พร้อมแยก symlink target โดยไม่โหลดไฟล์ทั้งหมด
- ปิด path traversal ใน app-server `prove.request`/`review.request`: explicit `changeId` ต้องเป็น 1–256 bytes และใช้เฉพาะ ASCII letters/numbers/`-_.`; regression `../../outside` คืน typed `invalid_request` ก่อนสร้าง/อ่าน artifact path

diagnostic soak 8 ชั่วโมงทั้งสองชุดจบตามธรรมชาติเมื่อ 09:06/09:07 และ assessor
รุ่นปัจจุบันปฏิเสธทั้งคู่ตามที่คาด จึงไม่ยกระดับเป็น GA soak evidence:

- storage: 28,800.0004 วินาที, 31,730,226 cycles × 1,000 events, exact replay
  ทุก cycle และ database growth 0 bytes แต่ record v1 ไม่มี required schema,
  wall timestamps, interruption flag และ start/end integrity binding
- mixed: 28,822.541 วินาที, 2,361 cycles, max RSS 92,064 KiB, FD 33,
  fixture growth 0, no orphan; มี 59 workload failures (shutdown 55, relay 4)
  และเป็น runner รุ่นเก่าที่มีเพียง 5 workloads ไม่มี mode/success counts/integrity/
  evaluated trend จึงไม่ตรง current 11-workload v2 contract

ระหว่างรอบนี้ได้เพิ่ม mixed-resource soak v2 ซึ่งวน queue/relay/router/shutdown/status, วัด process-tree RSS, file descriptors, fixture growth และ orphan process groups พร้อม validator ที่บังคับอย่างน้อย 100 cycles ต่อ workload และผูก hash ของ `cloop`, probe, `Cargo.lock`, runner และ Git revision ตั้งแต่ต้นจนจบ การรัน 8 ชั่วโมงที่เริ่มก่อน integrity patch/ก่อน release binary rebuild จะถูกรายงานเป็น diagnostic เท่านั้นและ validator รุ่นใหม่ตั้งใจปฏิเสธ ไม่ถูกยกระดับเป็น GA evidence

### Supply-chain และ repository compatibility

ตัวเลขชุดนี้เป็น historical/operator-observed ระหว่าง development; baseline table
ด้านบนมาจาก source-frozen run ก่อน hardening ล่าสุด และ compatibility matrix ถูกขยายภายหลัง
ให้ release mode ถือทุก required `SKIP` เป็น failure

- `cargo audit`: ตรวจ 347 dependencies ไม่พบ blocking vulnerability
- `cargo deny`: ผ่าน (มีเฉพาะ permitted warnings)
- SBOM: สร้างและ validate ได้ 22 รายการ
- checksum/tamper/rollback tests: ผ่าน
- historical host run สร้าง/verify package ที่ตั้งชื่อ target `aarch64-apple-darwin` ผ่าน; algorithm รองรับสี่ target แต่ไม่ได้แปลว่า execute บน runner ทั้งสี่แล้ว
- host archive build ซ้ำสองรอบได้ SHA256 ตรงกัน; `cloop`/`claude-foundation` executable และ alias ส่งต่อไปยัง binary ที่ update แล้ว
- release automation regression ผ่าน รวม omitted archive, malicious symlink, reproducibility, alias/update rollback; ops 7/7, release CLI 2/2, migrate CLI 1/1
- compatibility matrix: 16 PASS, 3 typed SKIP, 0 FAIL หลังเปลี่ยน multi-repository declaration จาก SKIP เป็นการทดสอบ effective config จริง

## Code Review และช่องว่างก่อน GA

รายการนี้จะปรับสถานะหลังงานและการทดสอบรอบสุดท้าย:

- [x] ตรวจว่า TUI commands ทุกคำสั่งเรียก app-server surface จริง
- [x] ตรวจ runtime wiring ของ shell/Git/test/question/PTY/jobs, LSP และ formatter
- [~] ตรวจ bounded automatic repair และ targeted re-prove แล้ว แต่ trusted authority สำหรับ repository-selected command ยังไม่ครบ
- [~] ตรวจ independent reviewer เป็น clean artifact-only subprocess แล้ว แต่ trusted authority สำหรับ repository-selected command ยังไม่ครบ
- [x] ตรวจ conversation intent → draft → explicit confirmation
- [x] ตรวจ operation-scoped steering/cancellation และ streaming concurrency
- [x] bounded Rust/Node/Foundation/security/compatibility/performance gates ผ่าน;
  current Rust 728/728, performance 17/17 และ composite local-release exit 0;
  release-mode SKIP/external/time-bound GA gates ยังคงแยกเป็นข้อจำกัด

Security review พบและแก้ defect จริงแล้ว:

- แก้ private artifact directory ที่เคย `chmod 0700` ใส่ directory เดิมจนทำให้
  read-only repository กลับเขียนได้: CLI ปฏิเสธ existing directory ที่ไม่มี
  owner `rwx` และ app ไม่เพิ่ม permission ให้ directory เดิม; regression ยืนยัน
  mode, state bytes และ proof lifecycle ไม่เปลี่ยนเมื่อถูกปฏิเสธ
- ปิด credential leakage และ raw closing-tag injection จาก `AGENTS.md`/task packets ด้วย redaction และ JSON provenance records ที่ `canAuthorize=false`
- ป้องกัน background job ค้างหรือส่ง terminal status ก่อน output ครบ เมื่อ descendant process ยังถือ stdout/stderr pipe
- ให้ formatter/LSP เป็นเจ้าของ process group และยุติทั้งกลุ่มเมื่อ timeout/shutdown
- content-sniff file/image attachments และปฏิเสธ declared MIME ที่ไม่ตรงกับ bytes
- harden HTTP/SSE/Unix transports ให้ fail-closed ต่อ malformed/duplicate security headers, oversized/slow requests, cursor ambiguity, stale-socket path replacement และ connection monopolization
- harden built-in CLI Git proof/review ด้วย hooksPath `/dev/null`, no ext-diff/
  textconv/fsmonitor/untracked-cache, ปิด global/system config, prompt และ pager;
  adversarial test พิสูจน์ raw malicious driver/config/hook รันได้แต่ hardened path
  ไม่รัน และ CLI package ผ่าน 74 tests พร้อม Clippy `-D warnings`

## Test incident: first-run config isolation

ระหว่าง PTY onboarding accept probe รุ่นแรก binary เก่ายังไม่ honor `XDG_CONFIG_HOME` จึงเขียน fixture ไปที่ user config path จริง `/Users/hashtagf/Library/Application Support/changeloop/first-run.json` ก่อน test จะตรวจ temp path ทีมย้ายไฟล์ fixture แบบ recoverable ไปที่ `/Users/hashtagf/Library/Application Support/changeloop/first-run.test-artifact-20260805.json` และไม่แตะ directory นี้ต่อ

- artifact มีเฉพาะ test setup (`openai`, `test-model-id`, disclosures, local-only telemetry และ read-only sandbox) ไม่มี credential/secret; SHA-256 `ed410c43c7a126db6636e663b12033688ebf5041abe81b491f8be87a482ecfbc`
- directory birth time คือ `2026-08-05 02:17:23 +0700` และ fixture birth time `02:17:29` ซึ่งเป็นหลักฐานที่ชี้ว่า directory ถูกสร้างใหม่โดย test และน่าจะไม่มี config เดิม แต่เนื่องจาก probe ไม่ตรวจ existence ก่อนเขียน จึงไม่อ้าง certainty 100%
- ไม่มี `first-run.json`, stage หรือ backup เหลืออยู่; artifact ถูกเก็บไว้ให้ผู้ใช้ตรวจ/กู้คืน/ลบเอง ไม่ถูกลบอัตโนมัติ
- root cause ถูกแก้ให้ app-server ใช้ `CHANGELOOP_CONFIG_HOME` → `XDG_CONFIG_HOME` → platform config ตามลำดับ; PTY probes ใช้ temp cwd/config และ assert ทั้ง accept/cancel paths

## ข้อจำกัดที่ต้องรายงานตามจริง

- diagnostic storage/mixed-resource records 8 ชั่วโมงจบแล้ว แต่ทั้งคู่ไม่ผ่าน
  current assessor และเริ่มก่อน source/runner hardening; ต้องรัน qualification
  ใหม่จาก freeze เดียวกัน จึงยังไม่อ้างว่า performance GA gate นี้ผ่าน
- current local performance suite ผ่าน 17/17 หลังแก้ runner ที่เคยตี stdout
  non-captured ของ relay เป็น overflow; three-cycle integration ระบุ trend เป็น
  unevaluated และ release assessor ยังคงบังคับ evaluated 100+ cycle trend
- composite `test:local-release` รอบก่อนแก้เคยไม่มี terminal EOF และถูกยกเลิก
  exit 130; พบ repo-owned probe เก่าค้างจาก unbounded wait/config inheritance,
  เพิ่ม cleanup/config/ANSI regressions แล้ว และ rerun ปัจจุบันจบ exit 0
- ยังไม่มี release run ที่ระบุ `reference-machine-id` และ baseline series พร้อม
  source identity คงที่ตลอดการวัด
- ไม่สามารถยืนยัน Apple signing/notarization หากไม่มี credentials และ external signing service
- live Anthropic/OpenAI tests ต้องใช้บัญชี/credentials จริง; corpus และ mock tests ไม่ใช่ live-provider proof
- platform matrix เต็มรูปแบบต้องรันบน macOS/Linux arm64/x64 ผ่าน CI จริง
- sandbox path ถูก exercise บน macOS ในรอบนี้; Linux `bwrap` ยังต้องรันบน target
  CI และ macOS sandbox จำกัด write/network/environment ได้ แต่ read confinement
  ยังกว้างกว่า Linux จึงไม่อ้าง cross-platform isolation parity
- snapshot path-swap protection ใช้ dirfd/`openat`/`renameat` บน macOS/Linux ตาม platform แรกของ roadmap; non-Unix fallback ยังเป็น portable best-effort และต้องทดสอบใหม่เมื่อเพิ่ม Windows
- non-image file attachments ตั้งใจคงเป็น typed CAS/source references และไม่ส่ง arbitrary binary เป็น native provider payload; native image path ผ่าน hermetic tests แต่ยังไม่ได้พิสูจน์กับบัญชี provider จริง
- app-server ไม่ restore lifecycle authority อัตโนมัติหลัง restart เพราะ repository artifacts เป็น untrusted content; `/change` ทำ bounded typed discovery เฉพาะ proof/review ที่เป็น regular file, มี session ใน SQLite และ workspace revision สด โดยคืน root/status พร้อม conservative high-risk floor และบังคับผู้ใช้ระบุ change ID ชัดเจน ส่วน confirmed Build ที่ยังไม่มี proof ไม่มีข้อมูลพอให้แยกจาก conversation อย่างปลอดภัย จึงตั้งใจไม่เดา
- release workflow และ CLI manifest chain เชื่อมกันแล้วใน hermetic integration test แต่ Apple signing/notarization, GitHub OIDC publication และ upgrade จาก release จริงยังต้องใช้ external CI/credentials
- OAuth tests รอบนี้ไม่แตะ keyring/account จริง; ความถูกต้องของ platform keyring backend และ provider-specific refresh/revoke behavior ต้องยืนยันอีกครั้งบน target CI/บัญชีทดสอบ โดยไม่มีการพิมพ์ token ลง test log
- TUI backend worker ใช้ cooperative cancellation; backend ที่ไม่ตอบสนองอย่าง
  ถาวรยังทำให้ thread join รอได้โดยไม่มีกลไกฆ่า Rust thread อย่างปลอดภัย จึงยัง
  ไม่อ้าง forced-cleanup ภายใน 2 วินาทีสำหรับ hostile/in-process backend
- repository เป็น untrusted content แต่ไฟล์ `.changeloop/proof-providers.json`
  และ `.changeloop/reviewer.json` ยังเลือก executable/arguments ได้เมื่อผู้ใช้สั่ง
  Prove/Review; ก่อน GA ต้องผูก selection นี้กับ trusted contract/permission ที่
  แสดงให้ผู้ใช้เห็น แยกจาก lifecycle intent เพียงอย่างเดียว พร้อม sandbox;
  ปัจจุบัน shared runner ล้าง environment แต่ยังมี host filesystem/network authority
- exact executor approval ต้อง bind canonical root/revision/config hash, executable
  path+bytes, ordered argv, environment, timeout/output caps, sandbox, writable paths,
  network policy, change/session และใช้ one-shot user/trusted-policy provenance;
  reviewer model family/accepted-risk authority ต้องมาจาก trusted attachment แยก
  ไม่รับค่าที่ reviewer process self-report ผ่าน stdout
- workspace revision ตัด `.changeloop` ออกทั้งหมด ขณะที่ executor config และ
  operational/proof/review authority artifacts อยู่ในนั้น จึงยังไม่มี config digest
  หรือ authenticated DB/MAC binding ป้องกัน repository evidence forgery/replay
- `privacy delete` ลบ SQLite/operational/privacy index แต่ยังไม่ลบ snapshot,
  proof, review, hook, archive/Land artifacts และ purge lock ไม่ร่วมกับ lifecycle
  writers; ต้องมี exact content-bound inventory, unified writer lock และ journaled
  nofollow quarantine ก่อนเรียก privacy deletion ว่าครบ
- process ที่ fork+`setsid` ออกจาก owned process group และถือ stdout/stderr pipe
  ไว้สามารถทำให้ tools/jobs/LSP/lifecycle runner ค้างที่ reader-thread join ได้;
  การ detach จะรั่ว resource จึงต้องแก้ด้วย OS containment และ bounded nonblocking
  drain พร้อม adversarial double-fork tests ก่อนอ้าง shutdown ต่ำกว่า 2 วินาที
- Land ยังมี same-user parent-directory swap window ใน path-based remove/create/
  rename; ต้องย้าย traversal/mutation ไป pinned dirfd/openat nofollow เช่น snapshot
- undo/redo ชดเชย ordinary save failure แล้ว แต่ process/power crash ระหว่าง file
  mutation กับ manifest commit ยังต้องมี prepared/applying/committed journal;
  snapshot cleanup ก็ต้อง commit manifest ใหม่ก่อน blob GC หรือใช้ two-phase journal
- SQLite `synchronous=NORMAL`, pre-write quota check, DNS resolver worker exhaustion
  และ migration lstat→path-open TOCTOU เป็น hardening backlog ที่ยังไม่ปิด
- release compatibility mode ตั้งใจ fail เมื่อ platform case ถูก SKIP; การ publish
  รุ่น tagged จึงยังถูก block จนกว่า snapshot/undo public checkpoint case และ
  target matrix ที่จำเป็นจะรันจริง ไม่ถูกนับเป็นผ่านจาก developer-mode SKIP
- child worktree อ่าน Git path เป็น bytes และ fail-closed ได้ แต่ public typed
  result ยังใช้ `Vec<String>` จึงยัง merge ชื่อไฟล์ raw non-UTF-8 ไม่ได้จนกว่า
  protocol จะมี byte-safe/path-encoding representation

## ลำดับงานที่ควรทำต่อ

1. สร้าง shared lifecycle-executable permission gate โดยใช้ policy engine เดิม,
   ผูก approval กับ config/argv digest, change/session และ workspace revision;
   sandbox proof/repair/reviewer และห้าม repository content อนุมัติตัวเอง
2. ย้าย operational/evidence authority เข้า authenticated SQLite หรือ signed/MAC
   record และรวม trusted config digest ใน proof/review freshness
3. ทำ privacy purge inventory+quarantine journal ภายใต้ unified writer lock และ
   ทำ Land/undo/cleanup เป็น dirfd/two-phase crash-recoverable transactions
4. แยก hostile backend/process ไว้ใน OS-contained child, ใช้ bounded nonblocking
   pipe drain และเพิ่ม `setsid`/double-fork regressions ก่อนปิด 2-second gate
5. เปลี่ยน child path schema เป็น byte-safe encoding และเพิ่ม public hermetic
   checkpoint fixture เพื่อให้ strict compatibility matrix เหลือ zero SKIP
6. รัน Rust 1.88 และ target matrix macOS/Linux arm64/x64 จริง, live provider,
   named reference machine, signing/notarization/OIDC และ installed upgrade ก่อน GA

## Timeline

- 00:xx–ช่วงต้น: ตรวจ baseline, performance, supply-chain และ compatibility evidence
- ช่วงดำเนินงาน: ศึกษา TUI ของ OpenSpec/OpenCode และปรับ runtime/TUI แบบขนาน
- 07:xx: independent policy/platform/storage audit ปิด YOLO/MCP pre-permission,
  atomic tool terminalization, undo-save rollback และ update-parent permission gaps;
  source-frozen Rust/Node/Foundation/compatibility/supply-chain baseline ผ่านใน
  จุด freeze นั้น แต่ hardening ภายหลังทำให้ต้อง verify ใหม่
- 07:5x–08:0x: แยก relay failure ได้ว่า workload exit 0/semantic pass แต่ runner
  buffer stdout ที่ไม่ capture; แก้ OS-boundary discard, เพิ่ม 3-cycle regression,
  แยก integration contract จาก long-run trend และ full performance ผ่าน 17/17
- รอบ local-release ล่าสุด: component gates เดินผ่านถึง performance แต่ test PTY
  ไม่คืน EOF หลัง process จบ จึงยุติ session ด้วย exit 130 และไม่อ้าง aggregate PASS
- 09:06–09:07: diagnostic soak ทั้งสองชุดจบ; storage exact replay/database growth
  ดีแต่ schema/integrity ไม่ครบ, mixed มี 59 failures/runner coverage เก่า และ
  assessor ปัจจุบันปฏิเสธทั้งคู่โดยไม่ยกระดับเป็น GA evidence
