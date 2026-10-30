# หน้าอนุมัติและข้อมูลของ harness

harness พิมพ์ข้อมูลและตรวจ ส่วนหน้าอนุมัติที่ผู้อนุมัติอ่านถูกสร้างโดย skill prototype

## ADDED Requirements

### Requirement: approval-data

คำสั่ง package SHALL พิมพ์ข้อมูลของ change เป็น JSON ได้แก่ ระดับความเสี่ยงพร้อมเหตุผล domain artifact ตาม role พร้อมป้ายหลักฐาน คำแนะนำ preview บรรทัด scratch รวม undo และ who รายการตรวจ section ที่บังคับ บรรทัดสถานะการอนุมัติ รายการที่หน้าต้องแสดง สถานะ covers สถานะ drift และ factsDigest โดย SHALL NOT เขียนไฟล์ HTML

#### Scenario: พิมพ์ข้อมูลครบ

- **GIVEN** change ระดับ Medium ที่มี draft และ receipt บางส่วน
- **WHEN** รัน claude-foundation package <change>
- **THEN** ได้ JSON ที่มีทุกหัวข้อข้างต้น และไม่มีไฟล์ HTML ถูกเขียนหรือเขียนทับใน .foundation/packages

#### Scenario: ค่าที่ไม่ทราบ

- **GIVEN** draft ไม่มี tasks paths และไม่มี openQuestions ที่นับได้
- **WHEN** รัน package
- **THEN** ตัวเลขนั้นเป็น unknown ไม่ใช่ 0 และไม่มีค่าที่เดา

#### Scenario: อ่าน evidence บางส่วนไม่ได้

- **GIVEN** receipt หนึ่งรายการอ่านไม่ได้
- **WHEN** รัน package
- **THEN** ได้ JSON ที่มี warnings ระบุรายการนั้นและข้อมูลส่วนอื่นยังอยู่

#### Scenario: change ที่ไม่มี draft แบบ typed

- **GIVEN** change เก่าที่ไม่มี typed draft
- **WHEN** รัน package
- **THEN** ได้ JSON ที่ระบุว่าข้อมูลจำกัดและช่องที่ไม่มีเป็น unknown

### Requirement: approval-page-authored-by-skill

harness SHALL NOT สร้างหรือเขียนทับหน้าอนุมัติ HTML ในทุกคำสั่ง และคำถามอนุมัติ SHALL ระบุ path ของหน้าที่ skill prototype เขียนไว้เมื่อไฟล์นั้นมีอยู่ มิฉะนั้น SHALL แสดงสรุปเป็นข้อความและบอกให้ใช้ skill prototype โดยไม่กั้น

#### Scenario: มีหน้าแล้ว

- **GIVEN** มีไฟล์ .foundation/previews/<change>/prototype.html และ draft ชี้ไฟล์นั้นเป็น example ชนิด prototype
- **WHEN** advance ถามเรื่องอนุมัติ
- **THEN** ข้อความเรียก หน้าอนุมัติ พร้อม path ของไฟล์นั้น

#### Scenario: ยังไม่มีหน้า

- **GIVEN** ไม่มีไฟล์หน้าอนุมัติของ change นี้
- **WHEN** advance ถามเรื่องอนุมัติ
- **THEN** ข้อความแสดงสรุป 4 บรรทัดเป็นข้อความและบอกว่ายังไม่มีหน้าอนุมัติให้ใช้ skill prototype และไม่หยุดการถาม

#### Scenario: ไม่เขียนไฟล์หน้า

- **GIVEN** รัน change start advance หรือ package
- **WHEN** คำสั่งทำงานจนเสร็จ
- **THEN** ไม่มีไฟล์ HTML ถูกสร้างหรือเขียนทับใน .foundation/packages และไฟล์เก่าที่มีอยู่ไม่ถูกแก้

#### Scenario: ตัวอย่างใน draft ยังถูกตรวจ

- **GIVEN** draft มี example ชนิดที่ไม่รู้จัก
- **WHEN** รัน change start
- **THEN** ได้ EDIT ที่ระบุ path ของ example นั้นตามเดิม และ harness ไม่เรนเดอร์ example ใด

### Requirement: prototype-checklist

ข้อมูลของ package และผลของ change start SHALL บอกรายการสิ่งที่หน้าอนุมัติของ change นี้ต้องแสดง โดยอนุมานจาก work type และฟิลด์ใน draft เท่านั้น ครอบคลุมทุก work type ที่ catalog ประกาศ และ SHALL NOT กั้น change start Build Prove หรือ Land

#### Scenario: งาน API

- **GIVEN** workType เป็น api และ draft มี apiContracts ที่มี error 400 เมื่อ title ว่าง
- **WHEN** รัน package
- **THEN** รายการมี แผง API ที่แสดง request response และกรณี error 400 พร้อม เส้นทางผู้ใช้ กรณีพลาดพร้อม recovery และ ก่อน-หลัง

#### Scenario: งานข้อมูล

- **GIVEN** workType เป็น migration และ draft มี migrationPlan กับ rollout
- **WHEN** รัน package
- **THEN** รายการมี schema ก่อน-หลัง ลำดับปล่อย และ rollback

#### Scenario: งานหน้าจอ

- **GIVEN** workType เป็น ui และ uiStates มี loading empty error success
- **WHEN** รัน package
- **THEN** รายการระบุว่าต้องแสดงครบทุกสถานะของทุกหน้าจอที่ draft ระบุ

#### Scenario: ครบทุก work type

- **GIVEN** catalog ประกาศ work type ทั้ง 26 ชนิด
- **WHEN** สร้างรายการของแต่ละชนิดแยกกัน
- **THEN** ทุกชนิดมีรายการอย่างน้อย 1 ข้อ และทุกข้อระบุฟิลด์ใน draft ที่เป็นที่มา หรือเป็นข้อร่วมคือ ก่อน-หลัง

#### Scenario: หลายชนิดรวมกัน

- **GIVEN** workType เป็น feature, api และ data
- **WHEN** รัน package
- **THEN** รายการเป็นผลรวมเรียงลำดับคงที่ ไม่มีข้อซ้ำ และแต่ละข้อบอกที่มา

#### Scenario: ฟิลด์ไม่ระบุ

- **GIVEN** workType เป็น api แต่ draft ไม่มี apiContracts
- **WHEN** รัน package
- **THEN** รายการมีแผง API ที่ต้องมี และระบุว่า draft ยังไม่ระบุ ไม่ประดิษฐ์ endpoint

#### Scenario: งานที่ไม่ต้องมีภาพมาก

- **GIVEN** workType เป็น docs เท่านั้น
- **WHEN** รัน package
- **THEN** รายการมีเฉพาะ ก่อน-หลัง และไม่เตือนว่าขาดอย่างอื่น

#### Scenario: ชนิดใหม่ที่ยังไม่มีรายการ

- **GIVEN** มีคนเพิ่ม work type ใหม่ใน catalog โดยไม่เพิ่มรายการ
- **WHEN** รันชุดทดสอบของ harness
- **THEN** ชุดทดสอบล้มและระบุชื่อชนิดที่ไม่มีรายการ

#### Scenario: ไม่กั้นการเริ่ม

- **GIVEN** draft ประเภท ui ยังไม่มีหน้าอนุมัติ
- **WHEN** รัน change start
- **THEN** พิมพ์ NOTE ที่ระบุรายการที่หน้าต้องแสดง โดยไม่ EDIT ไม่ถามผู้ใช้ และไม่หยุด

### Requirement: prototype-coverage-declared

ตัวอย่างชนิด prototype SHALL ประกาศ covers เป็นรายการ key ของข้อที่ต้องแสดง และข้อมูลของ package SHALL รายงานข้อที่ประกาศครอบคลุม ข้อที่ยังขาด และข้อที่ไม่ทราบ โดยไม่ถือการประกาศเป็น proof

#### Scenario: ครอบคลุมครบ

- **GIVEN** prototype ประกาศ covers ครบทุกข้อในรายการที่ต้องแสดง
- **WHEN** รัน package
- **THEN** ทุกข้อมีสถานะประกาศครอบคลุม และสรุปว่าประกาศครบ

#### Scenario: ยังขาด

- **GIVEN** prototype ไม่ประกาศ covers ของแผง API
- **WHEN** รัน package
- **THEN** ข้อแผง API มีสถานะ ยังขาด พร้อมชื่อข้อ

#### Scenario: ไม่ประกาศ covers

- **GIVEN** prototype ไม่มีฟิลด์ covers
- **WHEN** รัน package
- **THEN** ทุกข้อเป็น unknown และไม่นับว่าครบ

#### Scenario: key ที่ไม่รู้จัก

- **GIVEN** covers มี key ที่ไม่อยู่ในรายการของ change นี้
- **WHEN** รัน change start
- **THEN** ได้ EDIT ที่ระบุ path ของ key นั้น

#### Scenario: ประกาศไม่ใช่ proof

- **GIVEN** prototype ประกาศ covers ครบแต่ไม่มี receipt ใด
- **WHEN** รัน package หรือ prove หรือ land
- **THEN** ข้อมูลระบุว่าเป็นคำประกาศของ agent ไม่ใช่ proof และ Prove กับ Land ไม่ใช้คำประกาศนั้น

### Requirement: facts-from-harness-only

ระดับความเสี่ยง จำนวน proof และสถานะ role lane SHALL มาจากการคำนวณของ harness เท่านั้น และ harness SHALL NOT อ่านค่าเหล่านี้จากไฟล์หน้าอนุมัติหรือ prototype

#### Scenario: หน้าอ้าง proof เอง

- **GIVEN** ไฟล์หน้าอนุมัติมีข้อความว่าผ่านทุกการทดสอบ แต่ไม่มี receipt ที่ผ่านจริง
- **WHEN** รัน package
- **THEN** จำนวน proof ในข้อมูลไม่เพิ่ม และป้ายหลักฐานของ artifact นั้นเป็น none

#### Scenario: preview ไม่ใช่ proof

- **GIVEN** มี receipt ชนิด preview ของ change นี้
- **WHEN** รัน package
- **THEN** ป้ายเป็น preview ไม่ใช่ proof และ Prove กับ Land ไม่ใช้ receipt นั้น

#### Scenario: ค่าความเสี่ยงมาจาก draft

- **GIVEN** draft ประกาศ impact high และ riskSignals financial
- **WHEN** รัน package
- **THEN** ระดับและเหตุผลคำนวณจาก draft และ path ของ task เท่านั้น

### Requirement: prototype-sync

harness SHALL บันทึก digest ของไฟล์หน้าอนุมัติและ factsDigest ของข้อมูลที่คำนวณทุกครั้งที่ change start revise หรือ amend และข้อมูลของ package กับคำถามอนุมัติ SHALL เตือนเมื่อไฟล์ถูกแก้หลังฉบับล่าสุด หรือเมื่อหน้าไม่มี factsDigest ล่าสุด โดย SHALL NOT กั้น change start Build Prove หรือ Land

#### Scenario: แก้ไฟล์แล้วเตือน

- **GIVEN** บันทึก digest ของ prototype.html ที่ฉบับ 2 แล้วไฟล์ถูกแก้
- **WHEN** รัน package
- **THEN** ข้อมูลมี drift true ระบุว่าถูกแก้หลังฉบับ 2 ให้ตรวจให้ตรงกับ change แล้ว change revise

#### Scenario: revise แล้วหายเตือน

- **GIVEN** ข้อมูลมี drift true
- **WHEN** agent แก้ draft ให้ตรงแล้วรัน change revise
- **THEN** digest ใหม่ถูกบันทึกและ drift เป็น false

#### Scenario: ข้อมูลของ harness ในหน้าล้าสมัย

- **GIVEN** หน้าอ้าง factsDigest เก่าเพราะมี receipt ใหม่หลังจากนั้น
- **WHEN** รัน package
- **THEN** ข้อมูลมี factsStale true และคำถามอนุมัติเตือนให้ skill อัปเดตแถบข้อเท็จจริงในหน้า

#### Scenario: แก้ไฟล์แต่ไม่แก้ change

- **GIVEN** หน้าถูกแก้แต่ change ไม่ถูก revise
- **WHEN** รัน advance หรือ prove
- **THEN** คำเตือนยังอยู่ แต่ไม่ถูกนับเป็น EDIT และไม่หยุดการทำงาน

#### Scenario: ไม่มีไฟล์

- **GIVEN** example ชนิด prototype ชี้ไฟล์ที่ไม่มี
- **WHEN** รัน package
- **THEN** ข้อมูลระบุว่ายังไม่มีไฟล์ และไม่มีคำเตือนเรื่อง drift หรือ facts

#### Scenario: คำเตือนไม่ใช่หลักฐาน

- **GIVEN** มีหรือไม่มีคำเตือนเรื่อง drift หรือ facts
- **WHEN** รัน prove หรือ land
- **THEN** ผลของ Prove และ Land ไม่เปลี่ยนเพราะสถานะนั้น

### Requirement: plain-approval-wording

คำถามอนุมัติ SHALL เรียกหน้านี้ว่า หน้าอนุมัติ ด้วยภาษาธรรมดา และคำสั่ง package SHALL ยังใช้ได้ในฐานะคำสั่งพิมพ์ข้อมูล

#### Scenario: คำถามอนุมัติ

- **GIVEN** draft ภาษา th ที่รอการอนุมัติและมีไฟล์หน้า
- **WHEN** advance ถามเรื่องอนุมัติ
- **THEN** ข้อความเรียก หน้าอนุมัติ พร้อม path ไฟล์ และไม่ใช้คำว่า package เป็นชื่อที่ผู้ใช้ต้องรู้

#### Scenario: ใช้คำสั่งเดิม

- **GIVEN** ผู้ใช้หรือ script เรียก package ของ change หนึ่ง
- **WHEN** รัน claude-foundation package <change>
- **THEN** คำสั่งไม่ error และพิมพ์ข้อมูลตาม approval-data

## REMOVED Requirements

### Requirement: package-render

ระบบ SHALL สร้าง approval package HTML แบบอ่านอย่างเดียวจาก change ที่ compile แล้ว

**Migration:** harness เลิกสร้าง HTML คำสั่ง package พิมพ์ข้อมูลตาม approval-data และหน้าอนุมัติถูกสร้างโดย skill prototype ตาม approval-page-contract

### Requirement: package-content

ระบบ SHALL แสดงเนื้อหาจริงของ agreement ใต้ artifact แต่ละรายการใน package

**Migration:** ผู้อนุมัติอ่านเนื้อหา agreement จาก packet ใน openspec/changes และหน้าอนุมัติของ skill ไม่บังคับให้ทำซ้ำ

### Requirement: package-preview-output

ระบบ SHALL แสดงสถานะและ output ท้ายของ preview receipt ใต้ artifact ที่ตรง capability

**Migration:** สถานะ preview ยังอยู่ในข้อมูลของ package ตาม approval-data ส่วนการแสดงผลเป็นหน้าที่ของ skill

### Requirement: failure-table-filter

ระบบ SHALL แสดงใต้ artifact เฉพาะ failure scenario ที่เกี่ยวข้องกับ concurrency และ retry

**Migration:** กรณีพลาดทั้งหมดแสดงในหน้าของ skill ตาม approval-page-contract

### Requirement: scratch-summary

ระบบ SHALL แสดงสรุป scratch ที่บนสุดของ package

**Migration:** บรรทัด scratch อยู่ในข้อมูลของ package และ skill วางลงหน้าตาม approval-page-contract ส่วนการบังคับใส่ scratch ตอน change start ยังเป็นไปตาม scratch-required-medium

### Requirement: scratch-examples

ระบบ SHALL render draft.examples เป็นบล็อกตามชนิดที่รองรับทั้ง 29 ชนิด

**Migration:** harness เลิก render ตัวอย่าง แต่ยังตรวจชนิดและฟิลด์ของ examples ใน draft ตามเดิม ตาม approval-page-authored-by-skill

### Requirement: example-actual

ระบบ SHALL แสดงผลจริงหลัง Build ของแต่ละตัวอย่างจาก receipt หรือ preview

**Migration:** สถานะ receipt และ preview อยู่ในข้อมูลของ package ตาม approval-data

### Requirement: package-language

ระบบ SHALL แสดงหัวข้อและป้ายของ package เป็นภาษาของ draft

**Migration:** skill ใช้ภาษาของ draft ตาม approval-page-contract

### Requirement: package-offline-diagrams

ระบบ SHALL render diagram ด้วย Mermaid ในเครื่องโดยไม่โหลดอะไรจากภายนอก

**Migration:** หน้าอนุมัติของ skill ไม่เรียกเครือข่ายตาม approval-page-contract และไฟล์ vendor/mermaid.min.js ยังคงอยู่ไม่ถูกลบ

### Requirement: decision-first-page

หน้า approval package SHALL แสดงสรุปและความเสี่ยงก่อนรายละเอียดเทคนิค

**Migration:** ลำดับของหน้าถูกกำหนดใน approval-page-contract

### Requirement: reviewer-details-collapsed

หน้า package SHALL พับตาราง role โดเมน test map API diagram และ preview ไว้ในส่วนเดียวที่ปิดตั้งต้น

**Migration:** รายละเอียดผู้ตรวจพับไว้ท้ายหน้าตาม approval-page-contract

### Requirement: risk-meter

หน้า package SHALL แสดงระดับความเสี่ยงเป็นแถบ 4 ระดับพร้อมคำกำกับ

**Migration:** ระดับความเสี่ยงอยู่ในข้อมูลของ package และ skill แสดงในแถบข้อเท็จจริงตาม approval-page-contract

### Requirement: before-after-and-questions

หน้า package SHALL แสดงก่อน-หลังเป็นการ์ดคู่และคำถามที่ค้างอยู่

**Migration:** ก่อน-หลังและคำถามที่ค้างอยู่แสดงในหน้าของ skill ตาม approval-page-contract

### Requirement: failure-cards

หน้า package SHALL แสดงกรณีพลาดจาก scenario ชนิด failure เป็นการ์ด

**Migration:** กรณีพลาดพร้อม recovery แสดงในหน้าของ skill ตาม approval-page-contract

### Requirement: type-cards

หน้า package SHALL จับ work type เป็นแบบ A ถึง G และแสดงการ์ดของแต่ละแบบ

**Migration:** รายการที่ต้องแสดงตามชนิดงานอยู่ใน prototype-checklist และ skill ออกแบบการแสดงผลเอง

### Requirement: required-checklist

หน้า package SHALL แสดงรายการตรวจของส่วนที่บังคับตาม requiredDevSections

**Migration:** สถานะของส่วนที่บังคับอยู่ในข้อมูลของ package ตาม approval-data

### Requirement: scratch-undo-who

draft SHALL รับ scratch.undo และ scratch.who และการ์ดแสดงสองบรรทัดนี้

**Migration:** draft ยังรับ scratch.undo และ scratch.who ตามเดิม ค่าทั้งสองอยู่ในข้อมูลของ package และ skill แสดงในหน้า

### Requirement: thai-readable

หน้า package SHALL ใช้ฟอนต์ sans ที่มีอักษรไทยในเครื่องเรียงตามลำดับ

**Migration:** skill เลือกฟอนต์ตาม design ของ project และใช้ฟอนต์ที่รองรับอักษรไทยตาม approval-page-contract

### Requirement: cards-new-types

หน้า package SHALL แสดง data-fix security และ cicd ในการ์ดแบบ E G และ F

**Migration:** ทั้ง 26 work type ครอบคลุมโดย prototype-checklist

### Requirement: flow-in-card-a

หน้า package SHALL วาด flow chart ของ userFlow.source ภายในการ์ดแบบ A

**Migration:** เส้นทางผู้ใช้เป็นข้อหนึ่งของรายการที่ต้องแสดงตาม prototype-checklist

### Requirement: sequence-in-cards

หน้า package SHALL วางแผนภาพใน diagrams ลงการ์ดที่เกี่ยวข้อง

**Migration:** skill วางแผนภาพในหน้าตามที่เหมาะสมกับ design ของ project

### Requirement: prototype-visible

หน้า package SHALL แสดงตัวอย่างชนิด prototype เป็นอันแรกและกางอยู่

**Migration:** prototype เป็นมุมมองหลักของหน้าอนุมัติตาม approval-page-contract และการไม่มี prototype ไม่กั้น change start ตาม approval-page-authored-by-skill

### Requirement: diagram-layout

หน้า package SHALL ใส่แต่ละแผนภาพในกรอบที่มีหัวข้อ

**Migration:** รูปแบบแผนภาพเป็นการตัดสินใจของ skill ตาม design ของ project

### Requirement: visual-fixes

ป้าย ก่อน และ หลัง ของการ์ดก่อน-หลัง SHALL แสดงเป็นป้ายคำกะทัดรัด

**Migration:** รูปแบบภาพเป็นการตัดสินใจของ skill ตาม design ของ project

### Requirement: no-decision-bar

หน้า package SHALL ไม่แสดงส่วนตัดสินใจท้ายหน้า

**Migration:** หน้าของ skill ไม่มีฟอร์มหรือปุ่มตัดสินใจตาม approval-page-contract การตอบในแชทคือการตัดสินใจ

### Requirement: approval-status-line

หน้า package SHALL แสดงบรรทัดสถานะเมื่อ revision นี้อนุมัติแล้วหรือรอ role lane

**Migration:** สถานะการอนุมัติอยู่ในข้อมูลของ package ตาม approval-data และ skill แสดงในแถบข้อเท็จจริง

### Requirement: visual-polish

หน้า package SHALL ดูเรียบร้อยและอ่านง่ายขึ้นด้วย CSS ล้วน

**Migration:** ความเรียบร้อยของภาพเป็นหน้าที่ของ skill ตาม design ของ project

### Requirement: approval-links-package

ระบบ SHALL แสดง path ของ package เมื่อ change รอการอนุมัติ spec

**Migration:** คำถามอนุมัติแสดง path ของหน้าที่ skill เขียนตาม approval-page-authored-by-skill
