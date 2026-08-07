---
title: Adapter และการต่อสาย
description: adapter ที่รันได้จริงห้าตัว execution.yaml ต่อมันเข้ากับเครื่องมือของโปรเจกต์คุณอย่างไร และ resource กันไม่ให้ provider ชนกันอย่างไร
---

Foundation แยกสัญญาเชิงพฤติกรรมที่คงที่ ออกจากการต่อสายที่เปลี่ยนได้ มันไม่ติดตั้ง test framework เบราว์เซอร์ หรือ dependency ของโปรเจกต์ — **โปรเจกต์ของคุณเป็นเจ้าของและล็อกเวอร์ชัน executable ทุกตัวที่ adapter เรียก**

## execution.yaml

ในขณะที่ [`evidence.yaml`](/docs/th/evidence/claims/) บอกว่า *อะไรต้องเป็นจริง* `execution.yaml` บอกว่า *ต้องรันอะไร* มันเปลี่ยนได้เมื่อ Build ค้นพบคำสั่ง พอร์ต และรายงานจริง และการเปลี่ยนสายไฟจะทำให้เฉพาะ fingerprint ของ provider ที่เกี่ยวข้องใช้ไม่ได้

```json
{
  "version": 1,
  "providers": {
    "test": {
      "adapter": "test-discovery",
      "command": ["npm", "test", "--", "--reporter=json"],
      "report": "test-results/unit.json",
      "minimum": 1
    }
  },
  "services": {}
}
```

## adapter ทั้งห้า

| Adapter | ใช้ทำอะไร |
|---|---|
| `command` | รันคำสั่งของโปรเจกต์แบบ deterministic หนึ่งคำสั่งต่อหนึ่ง provider |
| `test-discovery` | รันคำสั่งเทสครั้งเดียว แล้วออก receipt ทั้ง test และ discovery |
| `playwright` | รันเทส Playwright ของโปรเจกต์ แล้วแมป claim annotation แบบมีโครงสร้าง |
| `contract-digest` | hash artifact ที่ประกาศไว้ในสองรีโปขึ้นไป ผ่านก็ต่อเมื่อ byte ตรงกัน |
| `external` | ต้องการ receipt จากระบบที่ Foundation ไม่ได้เป็นคนรัน |

### command

```json
"static-analysis": {
  "adapter": "command",
  "command": ["npm", "run", "check"],
  "timeoutMs": 120000
}
```

### test-discovery

หนึ่งโปรเซส สอง receipt ต้องใช้กับ capability `test`

```json
"test": {
  "adapter": "test-discovery",
  "command": ["npm", "test", "--", "--json"],
  "report": "test-results/unit.json",
  "minimum": 1
}
```

### playwright

```json
"browser": {
  "adapter": "playwright",
  "command": ["npx", "playwright", "test"],
  "project": "chromium",
  "outputs": ["accessibility"],
  "inputMode": "browser-automation"
}
```

สำหรับคำสั่ง Playwright ตรง ๆ adapter จะเติม `--reporter=json` และ `--project` ที่ตั้งค่าไว้ให้ ถ้ายังไม่ได้ใส่มา ส่วนคำสั่ง wrapper อย่าง `npm run e2e` ต้องส่งต่อ option เหล่านั้นเอง หรือเขียนไฟล์ `report` ที่ตั้งค่าไว้

เทสเบราว์เซอร์ทุกตัวที่พิสูจน์ claim ต้องมี claim annotation

```ts
test("owner updates profile", {
  annotation: { type: "claim", description: "profile-update" }
}, async ({ page }) => {
  // interaction and assertions
});
```

การ exit สำเร็จ **โดยไม่มี** annotation ครบถือเป็น `inconclusive` ไม่ใช่ `pass` และ claim จะไม่ถูกนับให้เทสที่ถูก skip

`outputs` ทำให้การรันครั้งเดียวออก receipt ได้หลาย capability — Playwright รันเดียวจึงตอบได้ทั้ง `browser` และ `accessibility`

:::tip[โหมด input]
browser automation ไม่ใช่ input ระดับระบบปฏิบัติการ ใช้ `browser-automation` กับ Playwright และสงวน `os-input` หรือ `both` ไว้สำหรับหลักฐานที่ต้องการหน้าต่าง native ที่ focus จริง ๆ
:::

Foundation อนุมานนโยบายเรื่อง console error จากการ exit สำเร็จของเบราว์เซอร์ไม่ได้ ให้ติดตั้ง Playwright fixture ที่ fail เมื่อเจอ `console.error` ที่ไม่คาดคิดและ uncaught page error

### contract-digest

ไม่รันคำสั่งใด ๆ มัน hash artifact สัญญาตัวเดียวกันในทุกรีโปที่ร่วมด้วย แล้วผ่านก็ต่อเมื่อ byte ตรงกัน ซึ่งเป็นสิ่งที่ทำให้ `cross-repo-contract` เป็น "การตรวจ" ไม่ใช่ "การกล่าวอ้าง"

```json
"cross-repo-contract": {
  "adapter": "contract-digest",
  "contract": {
    "profile-api": "contracts/profile.v1.json",
    "web": "src/contracts/profile.v1.json"
  }
}
```

ต้องมีอย่างน้อยสองรีโป เพราะสัญญา "ที่ใช้ร่วมกัน" ที่มีผู้ร่วมคนเดียวไม่ได้พิสูจน์อะไรเรื่องการตกลงกัน และ provider แบบ `contract-digest` พาดหลายรีโป จึงประกาศ `repository` เดี่ยวไม่ได้

### external

สำหรับ CI ผู้รีวิว หรือระบบอื่นที่ Foundation ต้องไม่รันเอง

```json
"review": {
  "adapter": "external",
  "claims": ["auth-boundary"],
  "ci": {
    "issuer": "github-actions",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n…"
  }
}
```

`publicKey` เป็นคีย์ Ed25519 แบบ PEM ดูขั้นตอน signed CI และ authority จากคนได้ที่ [`/prove`](/docs/th/loop/prove/)

## ตั้งต้นการต่อสาย

เมื่อ change ประกาศ claim ไว้แล้วแต่ `execution.yaml` ยังไม่มี provider

```bash
claude-foundation evidence detect <change>    # อ่าน manifest ไม่รันอะไร
claude-foundation evidence init <change>      # ดูตัวอย่างก่อน
claude-foundation evidence init <change> --write
claude-foundation evidence doctor <change>    # อธิบายว่ายังเหลืออะไรที่ยังไม่ลงตัว
```

`detect` อ่าน manifest และการตั้งค่าที่รีโปเป็นเจ้าของ **โดยไม่รันสคริปต์** ส่วน `init` เป็นแค่ตัวอย่างจนกว่าจะใส่ `--write` และแม้ใส่แล้วก็เพิ่มเฉพาะการต่อสายที่มั่นใจสูง พร้อมรักษา provider เดิมไว้ กรณีที่กำกวม ต้องใช้อำนาจภายนอก ขาดจำนวนเทส หรือรอผู้ปฏิบัติงานรีวิว จะยังไม่ถูกแก้และมี action ถัดไปบอกไว้ชัดเจน

การตั้งต้นไม่เคยติดตั้ง dependency ไม่สร้าง receipt ไม่ลดทอน claim และไม่ถือว่าการตรวจพบคือการพิสูจน์

## Resource และการทำงานคู่ขนาน

resource เริ่มต้นถูกระบุพร้อมชื่อรีโป suite ของสองรีโปจึงไม่ต้องมารอคิวกัน

- command / test — `workspace-read`
- Playwright — `workspace-read`, `dev-server:<repo>`, `browser:<repo>`
- mutation — `workspace-write:<repo>`
- `contract-digest` — `workspace-read`

provider ที่อ่านอย่างเดียวรันพร้อมกันได้ ส่วน `workspace-write` ชนกับผู้อ่าน workspace ทุกตัว และ resource แบบ exclusive ที่มีชื่อ เช่น `browser`, `dev-server` หรือ `database` ทับกันไม่ได้

override ได้ด้วย `resources` และจัดลำดับด้วย `dependsOn` ใช้ชื่อที่มีพารามิเตอร์ เช่น `port:4173`, `database:test` หรือ `browser:chromium` เมื่ออินสแตนซ์อิสระอาจรันพร้อมกัน วงจร dependency ของ provider และการชนกันของรายงานจะถูกปฏิเสธโดย `proof preflight`

provider สองตัวในคนละรีโปที่ใช้ resource เดียวกันจริง ๆ — ฐานข้อมูลตัวเดียว โปรไฟล์เบราว์เซอร์เดียว — ต้องประกาศเอง ค่าเริ่มต้นอนุมานให้ไม่ได้

## Service, พอร์ต และ secret

readiness URL ของ service ต้องระบุพอร์ตตรง ๆ และ **การ probe readiness ที่ประกาศไว้ทุกอันต้องมี body หรือ header ที่ระบุตัวตนที่คาดหวัง** — probe ที่ดูแค่ status code จะถูกปฏิเสธ เพราะโปรเซสอื่นอาจกำลังยึดพอร์ตนั้นอยู่

readiness probe ที่ประกาศไว้แต่ไม่ได้ถูกสังเกตจริงจะ fail กับทุก adapter ไม่ใช่แค่ Playwright

ค่า environment ที่ไม่เป็นความลับใส่ใน `env` ได้ ส่วน secret, credential, token, รหัสผ่าน และ API key ต้องใช้ `envFrom` ซึ่งระบุแค่ชื่อตัวแปรที่จะรับสืบทอดมา **โดยไม่เก็บค่าลงใน OpenSpec**
