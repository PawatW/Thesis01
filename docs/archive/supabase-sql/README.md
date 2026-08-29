# SQL ชุด Supabase เดิม (เก็บไว้อ้างอิงในเล่มเท่านั้น)

> ย้ายมาที่นี่ 2026-08-19 ตอนลบ Supabase ออกจากโปรเจกต์
> **ไม่ได้ใช้รันแล้ว** — สคีมาจริงอยู่ที่ `anan-api/prisma/schema.prisma` และ migration จริงอยู่ที่ `anan-api/prisma/migrations/`

## ทำไมยังเก็บไว้

โปรเจกต์นี้เปลี่ยนสถาปัตยกรรมกลางทาง (2026-08-15): จาก **client คุยกับ Postgres ตรงผ่าน PostgREST + RLS**
มาเป็น **API ของเราเองที่เป็นด่านเดียวที่แตะฐานข้อมูลได้** ไฟล์ในโฟลเดอร์นี้คือหลักฐานของสถาปัตยกรรมแรก
ซึ่งเล่มใช้เปรียบเทียบสองแนวทาง (ดู [database-schema.md](../../database-schema.md) และ [security-design.md](../../security-design.md))

| ของ | คืออะไร |
|---|---|
| `migrations/` (6 ไฟล์) | schema + **RLS policy · GRANT รายคอลัมน์ · RPC** ของยุค Supabase — จุดที่น่าสนใจคือ `20260725000001_security_hardening.sql` (ปิดช่องโหว่ 15 ข้อที่ตรวจเจอ) และ `20260815000001_rpc_writes.sql` (ย้ายการเขียนทั้งหมดไปอยู่ใน RPC) |
| `tests/` (4 ไฟล์) | pgTAP 94 assertions — ทดสอบ privilege, พฤติกรรม RLS, state machine และ RPC ที่ระดับฐานข้อมูล |
| `security_checks.sql` | สคริปต์ตรวจความปลอดภัยแบบอ่านอย่างเดียว (ตารางไหนเปิด RLS, ใครมี grant อะไร) |

## ข้อเปรียบเทียบที่เขียนในเล่มได้

- **RLS บังคับความปลอดภัยให้อัตโนมัติแม้คนเขียน query ลืม** — ส่วนสถาปัตยกรรมใหม่ต้องอาศัยวินัย (ownership อยู่ใน `where` ของทุก service)
  จึงต้องมี [security-rules.md](../../security-rules.md) §B และ e2e เคส "คนอื่นเรียก → 404" ทุก endpoint มาชดเชย
- แลกกับการที่ business logic ที่ซับซ้อน (ทรานแซกชันข้ามหลายตาราง · engine · การคืนเงิน) เขียนและทดสอบง่ายกว่ามากใน TypeScript
