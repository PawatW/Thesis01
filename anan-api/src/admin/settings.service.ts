import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-exception';
import {
  MAIL_SETTINGS_ID,
  MailSettingsService,
} from '../mail/mail-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  toMailSettingsResponse,
  type MailSettingsResponse,
  type UpdateMailSettingsDto,
} from './dto/settings.dto';

/**
 * ตั้งค่าเมลของระบบ (หน้าจอผู้ดูแล)
 *
 * ★ สองด่านที่ไม่ได้อยู่ที่หน้าจอ ★
 * 1. เปิดโหมด DEV ได้เฉพาะเมื่อ env ของเครื่องอนุญาต — บัญชี admin ที่ถูกยึด
 *    จึงเปลี่ยนเส้นทางอีเมลของผู้ใช้จริงทั้งระบบไม่ได้
 * 2. ทุกการบันทึกลง audit log ในทรานแซกชันเดียวกับการเขียนค่า — การเปลี่ยน
 *    ปลายทางอีเมลของทั้งระบบต้องไม่มีทางเกิดขึ้นแบบไม่มีร่องรอย
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MailSettingsService,
    private readonly audit: AuditService,
  ) {}

  async getMailSettings(): Promise<MailSettingsResponse> {
    const row = await this.settings.raw();
    const effective = await this.settings.effective();
    return toMailSettingsResponse(row, {
      uatModeAvailable: this.settings.isUatModeAvailable(),
      smtpConfigured: effective.smtp != null,
    });
  }

  async updateMailSettings(
    dto: UpdateMailSettingsDto,
    actorId: string,
  ): Promise<MailSettingsResponse> {
    // ★ ด่านจริงของโหมด DEV อยู่ตรงนี้ ไม่ใช่ที่ปุ่มบนหน้าจอ ★
    // ยิง PUT ตรงด้วย curl ก็ยังผ่านไม่ได้เมื่อเครื่องไม่ได้เปิดสวิตช์ env ไว้
    if (dto.redirectEnabled && !this.settings.isUatModeAvailable()) {
      throw AppError.forbidden(
        'UAT_MODE_UNAVAILABLE',
        'เครื่องนี้ไม่อนุญาตให้เปิดโหมดเปลี่ยนเส้นทางอีเมล (ต้องตั้ง MAIL_UAT_MODE_AVAILABLE=true และต้องไม่ใช่ production)',
      );
    }

    const before = await this.settings.raw();

    /**
     * ★ ปลายทางของ SMTP เปลี่ยนได้เฉพาะบนเครื่องที่อนุญาตโหมด DEV ★
     *
     * "สลับไป Mailtrap ตอนซ้อมเดโม่" คือเจตนาทั้งหมดของช่องพวกนี้ — บน production
     * เซิร์ฟเวอร์เมลเป็นค่าของการ deploy ไม่ใช่ของหน้าเว็บ · ถ้าเปิดไว้ บัญชี admin
     * ที่ถูกยึดจะชี้ host ไปที่รีเลย์ของตัวเองแล้วรับอีเมลของทั้งระบบได้ และยัง
     * อ่านผลการเชื่อมต่อกลับมาจากคอลัมน์ `error` ของ `email_logs` ได้ด้วย
     * (กลายเป็นช่องส่องเครือข่ายภายในไปในตัว)
     *
     * `mailFrom` ไม่อยู่ในด่านนี้ — เป็นแค่ชื่อผู้ส่งที่ผู้รับเห็น และเป็นค่าที่
     * ควรแก้ได้บนระบบจริง (SMTP header injection ถูกกันด้วย CHECK ที่ DB แล้ว)
     */
    const smtpTargetChanged =
      (dto.smtpHost ?? null) !== before.smtpHost ||
      (dto.smtpPort ?? null) !== before.smtpPort ||
      dto.smtpSecure !== before.smtpSecure;

    if (smtpTargetChanged && !this.settings.isUatModeAvailable()) {
      throw AppError.forbidden(
        'SMTP_TARGET_LOCKED',
        'เครื่องนี้ไม่อนุญาตให้เปลี่ยนเซิร์ฟเวอร์ SMTP จากหน้าจอ — แก้ที่ .env ของ API แทน',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.mailSetting.update({
        where: { id: MAIL_SETTINGS_ID },
        data: {
          redirectEnabled: dto.redirectEnabled,
          // ปิดโหมดแล้วล้างปลายทางทิ้ง — ค่าที่ค้างไว้คือกับดักรอวันที่มีคนกดเปิดอีกครั้ง
          redirectTo: dto.redirectEnabled ? dto.redirectTo : null,
          redirectCc: dto.redirectEnabled ? (dto.redirectCc ?? null) : null,
          smtpHost: dto.smtpHost ?? null,
          smtpPort: dto.smtpPort ?? null,
          smtpSecure: dto.smtpSecure,
          mailFrom: dto.mailFrom ?? null,
          updatedById: actorId,
        },
      });

      await this.audit.record(
        {
          action: 'mail_settings_updated',
          actorId,
          targetType: 'mail_settings',
          summary: summarise(before, updated),
          // เก็บเฉพาะค่าที่ไม่ใช่ความลับ — ไม่มี user/pass ของ SMTP อยู่ในระบบนี้อยู่แล้ว
          detail: {
            redirectEnabled: updated.redirectEnabled,
            redirectTo: updated.redirectTo,
            smtpHost: updated.smtpHost,
          },
        },
        tx,
      );

      return updated;
    });

    const effective = await this.settings.effective();
    return toMailSettingsResponse(row, {
      uatModeAvailable: this.settings.isUatModeAvailable(),
      smtpConfigured: effective.smtp != null,
    });
  }
}

/** ข้อความสรุปสำหรับหน้า log — บอก "อะไรเปลี่ยน" ไม่ใช่ "ค่าปัจจุบันคืออะไร" */
function summarise(
  before: {
    redirectEnabled: boolean;
    redirectTo: string | null;
    smtpHost: string | null;
  },
  after: {
    redirectEnabled: boolean;
    redirectTo: string | null;
    smtpHost: string | null;
  },
): string {
  const parts: string[] = [];

  if (before.redirectEnabled !== after.redirectEnabled) {
    parts.push(
      after.redirectEnabled
        ? `เปิดโหมดเปลี่ยนเส้นทางอีเมล → ${after.redirectTo ?? '-'}`
        : 'ปิดโหมดเปลี่ยนเส้นทางอีเมล',
    );
  } else if (after.redirectEnabled && before.redirectTo !== after.redirectTo) {
    parts.push(`เปลี่ยนปลายทางอีเมลเป็น ${after.redirectTo ?? '-'}`);
  }

  if (before.smtpHost !== after.smtpHost) {
    parts.push(
      `เปลี่ยนเซิร์ฟเวอร์ SMTP เป็น ${after.smtpHost ?? 'ค่าจาก .env'}`,
    );
  }

  return parts.length > 0
    ? `แก้ตั้งค่าเมล: ${parts.join(' · ')}`
    : 'บันทึกตั้งค่าเมล (ค่าหลักไม่เปลี่ยน)';
}
