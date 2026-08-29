import { Injectable } from '@nestjs/common';
import type { MailSetting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** ค่าที่ MailService ใช้จริง — รวมร่างระหว่างแถวใน DB กับ `.env` แล้ว */
export interface EffectiveMailConfig {
  redirectEnabled: boolean;
  redirectTo: string | null;
  redirectCc: string[];
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
  } | null;
}

/** id ของแถวเดียวในตาราง — CHECK `mail_settings_singleton` บังคับไว้ที่ DB ด้วย */
export const MAIL_SETTINGS_ID = 1;

/**
 * ตั้งค่าเมล — จุดเดียวที่ตอบว่า "ตอนนี้ระบบส่งเมลด้วยค่าอะไร"
 *
 * ★ ลำดับความสำคัญ: DB ทับ `.env` เฉพาะช่องที่กรอกไว้ ★ ช่องที่เว้นว่างใน DB
 * แปลว่า "ใช้ของ `.env` ตามเดิม" ไม่ใช่ "ไม่มีค่า" — ผู้ดูแลจึงเปลี่ยนแค่ host
 * ไปชี้ Mailtrap ตอนซ้อมเดโม่ได้โดยไม่ต้องกรอกค่าอื่นซ้ำทั้งชุด
 *
 * ★ `SMTP_USER` / `SMTP_PASS` ไม่มีทางมาจาก DB ★ เป็น credential จริง —
 * กฎข้อ 7 ของโปรเจกต์บอกว่าของพวกนี้อยู่ใน `.env` เท่านั้น (ดู security-design §5)
 */
@Injectable()
export class MailSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * โหมด DEV เปิดจากหน้าจอได้ไหม — ด่านนี้อยู่ที่ **env ของเครื่อง** ไม่ใช่ที่สิทธิ์ผู้ใช้
   *
   * เหตุผล: การเปลี่ยนเส้นทางอีเมลทั้งระบบบน production แปลว่าผู้ใช้จริงไม่ได้รับ
   * ลิงก์กู้บัญชีอีกเลย และคนที่ถือปลายทางนั้นได้ลิงก์ของทุกคนแทน — บัญชี admin
   * ที่ถูกยึดจึงต้องทำแบบนั้นไม่ได้ ต่อให้ล็อกอินสำเร็จ (รูปแบบเดียวกับ DEMO_MODE)
   *
   * อ่าน `process.env` สด ๆ ไม่ผ่าน ConfigService ด้วยเหตุผลเดียวกับ MailService
   */
  isUatModeAvailable(): boolean {
    return (
      process.env.MAIL_UAT_MODE_AVAILABLE === 'true' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  /** แถวดิบสำหรับหน้าจอผู้ดูแล — สร้างให้ถ้ายังไม่มี (เครื่องที่ migrate มาก่อน) */
  async raw(): Promise<MailSetting> {
    const row = await this.prisma.mailSetting.findUnique({
      where: { id: MAIL_SETTINGS_ID },
    });
    if (row != null) return row;
    return this.prisma.mailSetting.upsert({
      where: { id: MAIL_SETTINGS_ID },
      create: { id: MAIL_SETTINGS_ID },
      update: {},
    });
  }

  /** ค่าที่ใช้ส่งจริง — เรียกทุกครั้งที่จะส่งเมล ไม่ cache (ผู้ดูแลกดบันทึกแล้วต้องมีผลทันที) */
  async effective(): Promise<EffectiveMailConfig> {
    const row = await this.raw();

    const host = row.smtpHost ?? process.env.SMTP_HOST;
    const from = row.mailFrom ?? process.env.MAIL_FROM;
    const envPort = Number(process.env.SMTP_PORT ?? 587);

    return {
      // ★ ด่าน env มาก่อนค่าใน DB เสมอ ★ ปิดที่ env แล้วต่อให้แถวใน DB บอกว่าเปิด
      // ระบบก็ยังส่งหาผู้รับจริง — คนที่ยึดบัญชี admin ได้จึงเปลี่ยนอะไรไม่ได้
      redirectEnabled: row.redirectEnabled && this.isUatModeAvailable(),
      redirectTo: row.redirectTo,
      redirectCc: splitCcList(row.redirectCc),
      smtp:
        host && from
          ? {
              host,
              port:
                row.smtpPort ??
                (Number.isFinite(envPort) && envPort > 0 ? envPort : 587),
              secure: row.smtpHost
                ? row.smtpSecure
                : process.env.SMTP_SECURE === 'true',
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
              from,
            }
          : null,
    };
  }
}

/** "a@x.com, b@y.com" → ['a@x.com', 'b@y.com'] · ว่าง/null → [] */
export function splitCcList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
