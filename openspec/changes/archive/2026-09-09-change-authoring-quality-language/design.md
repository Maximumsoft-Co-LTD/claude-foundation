# Design

## Current state

คำสั่ง Change เดิมกำหนดภาษาของคำตอบ แต่ไม่ได้กำหนดภาษาของเนื้อหาเอกสาร
workflow มี schema และขั้นตอน compile แต่ยังไม่มีเกณฑ์ความครบของเนื้อหา
compiler รองรับ description ที่กำหนดเอง หากไม่มีจะเติม The system SHALL
ไว้หน้าผลลัพธ์ จึงต้องระบุประโยค requirement สำหรับภาษาที่ไม่ใช่อังกฤษ

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| description | ประโยค requirement ฉบับเต็มที่ compiler นำไปใช้ | การใช้ title แทนข้อความ requirement |
| outcome | ผลลัพธ์ที่สังเกตและตรวจสอบได้ | ขั้นตอน implementation ที่ไม่มีผลลัพธ์ |

## Decisions

none

## Compatibility and migration

ใช้ฟิลด์ description ที่ compiler รองรับอยู่แล้ว รักษาชื่อฟิลด์ enum marker
และตัวระบุ canonical ไม่เพิ่มฟิลด์บังคับหรือเปลี่ยน protocol เอกสารเดิมที่ไม่ได้
อยู่ในขอบเขตงานไม่ต้องแปลย้อนหลัง ไม่มีการย้ายข้อมูลหรือขั้นตอน rollout เพิ่ม

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| agent เติมรายละเอียดไม่ครบแม้ schema ผ่าน | กำหนดเกณฑ์และอ่าน packet หลัง compile | agent และ review |
| คำแนะนำใหม่หายหรือทำให้เกิน context budget | ตรวจ instruction contract และเพดาน 200 คำ | test |
| requirement ภาษาไทยมีประโยคอังกฤษเติมหน้า | ระบุ description ฉบับเต็มพร้อม SHALL | agent และ review |
