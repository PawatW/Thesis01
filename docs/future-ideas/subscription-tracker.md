# ไอเดียเก็บไว้ทำทีหลัง: Subscription Tracker

> สถานะ: **Backlog** — ยังไม่ทำในเฟสแรก (จดไว้เมื่อ 2026-07-10)
> โฟกัสปัจจุบันของโปรเจกต์คือ Subscription Marketplace สำหรับสินค้าจริง (physical products)

## แนวคิด

ฟีเจอร์/แอพช่วยติดตาม subscription ที่ผู้ใช้จ่ายอยู่กระจัดกระจาย (Netflix, Spotify, YouTube Premium ฯลฯ)

## ฟีเจอร์ที่เคยคิดไว้

- เพิ่ม/บันทึกรายการ subscription ที่มี (กรอกเอง)
- แจ้งเตือนก่อนถึงรอบตัดเงิน / ต่ออายุ
- Dashboard สรุปรายจ่ายรวมต่อเดือน / ต่อปี
- วิเคราะห์ว่า subscription ไหนไม่ค่อยได้ใช้ ควรยกเลิก

## เหตุผลที่พักไว้ก่อน

- ไม่ใช่จุดขายหลักของโปรเจกต์ — จุดขายคือ marketplace สินค้าแบบ recurring
- ทำทีหลังได้ง่าย เพราะเป็นฟีเจอร์ standalone ไม่ผูกกับระบบ order/payment

## ข้อควรรู้ถ้ากลับมาทำ

- Netflix/Spotify **ไม่มี API เปิดให้ third-party ดึงข้อมูลบิลหรือจัดการ subscription** — tracker จึงต้องเป็นแบบผู้ใช้กรอกเอง (manual entry) หรืออ่านจากอีเมลใบเสร็จ/SMS
- คู่แข่งที่ควรศึกษา: Rocket Money (Truebill), Bobby, Subly
- จุดต่อยอดที่เข้ากับแอพหลัก: รวม subscription สินค้าในแอพเรา + subscription นอกแอพ ไว้ใน dashboard เดียว
