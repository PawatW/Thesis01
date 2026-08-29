import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import {
  MailSettingsService,
  type EffectiveMailConfig,
} from './mail-settings.service';

/**
 * อีเมลขาออกของระบบ — ทางออกเดียวของเมลทุกฉบับ
 *
 * ★ ทุกฉบับผ่าน `send()` ★ การเปลี่ยนเส้นทางโหมด DEV กับการบันทึก log อยู่ที่นั่น
 * ที่เดียว — feature ใหม่ที่ส่งเมลเองด้วย nodemailer ตรง ๆ จะหลุดทั้งสองอย่าง
 *
 * ★ อ่านค่าตั้งค่าใหม่ทุกครั้งที่ส่ง ไม่ cache ★ ผู้ดูแลกดบันทึกที่หน้าจอแล้วต้อง
 * มีผลกับเมลฉบับถัดไปทันที ไม่ใช่หลังรีสตาร์ต API
 *
 * ยังไม่ตั้ง SMTP = ไม่ส่ง แต่พิมพ์ลิงก์ลง log ให้แทน (เครื่องพัฒนา/เดโม่ที่ไม่มี
 * เน็ตยังไล่ flow ได้ครบ) — บน production ทำแบบนั้นไม่ได้ ทั้งเพราะ log ไม่ใช่ที่
 * ของ token และเพราะผู้ใช้จริงจะกู้บัญชีไม่ได้เงียบ ๆ · `env.ts` จึงบังคับให้
 * SMTP_HOST + MAIL_FROM มีค่าเมื่อ NODE_ENV=production ตั้งแต่ตอนบูต
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** transporter ถือ connection pool ไว้ — สร้างใหม่ต่อเมลคือการเปิด TCP ทิ้งทุกครั้ง */
  private cached: { key: string; transporter: Transporter } | null = null;

  constructor(
    private readonly settings: MailSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ส่งลิงก์ตั้งรหัสผ่านใหม่
   *
   * ตัวเมลไม่มีอะไรที่บอกได้ว่าบัญชีนี้เป็นใครในระบบนอกจากอีเมลปลายทางเอง —
   * ไม่ใส่ชื่อร้าน ไม่ใส่บทบาท ไม่ใส่ยอดเงิน เพราะกล่องเมลอาจไม่ได้อยู่กับเจ้าของแล้ว
   */
  async sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<void> {
    await this.send({
      kind: 'password_reset',
      to: input.to,
      subject: 'ตั้งรหัสผ่านใหม่สำหรับบัญชี ANAN',
      text: passwordResetText(input.resetUrl, input.expiresInMinutes),
      html: passwordResetHtml(input.resetUrl, input.expiresInMinutes),
      // ใช้เฉพาะตอนที่ยังไม่ได้ตั้ง SMTP บนเครื่องพัฒนา — ไม่เคยลง DB
      devHint: input.resetUrl,
    });
  }

  /**
   * ★ ทางออกเดียวของเมลทุกฉบับ ★
   *
   * ลำดับ: อ่านค่าตั้งค่า → ตัดสินปลายทาง → ส่ง → บันทึก log
   * การบันทึก log **ห้ามทำให้การส่งล้ม** (ห่อ try/catch) เพราะเมลที่ส่งออกไปแล้ว
   * เรียกคืนไม่ได้ การโยน error หลังจากนั้นมีแต่จะทำให้ผู้เรียกเข้าใจผิดว่าไม่ได้ส่ง
   */
  private async send(msg: {
    kind: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    devHint?: string;
  }): Promise<void> {
    const cfg = await this.settings.effective();
    const redirected = cfg.redirectEnabled && cfg.redirectTo != null;
    const toActual = redirected ? cfg.redirectTo! : msg.to;
    const ccActual = redirected ? cfg.redirectCc : [];

    const envelope = redirected
      ? {
          // ★ ผู้รับตัวจริงต้องอยู่ในหัวเรื่องด้วย ★ ไม่ใช่แค่ในเนื้อเมล — กล่อง QA
          // ที่รับเมลของทุกคนรวมกันจะแยกไม่ออกเลยว่าฉบับไหนของใครถ้าดูแค่รายการ
          subject: `[DEV → ${msg.to}] ${msg.subject}`,
          text: `${redirectBannerText(msg.to)}\n\n${msg.text}`,
          html: `${redirectBannerHtml(msg.to)}${msg.html}`,
        }
      : { subject: msg.subject, text: msg.text, html: msg.html };

    if (cfg.smtp == null) {
      this.logUnconfigured(msg.to, msg.devHint);
      await this.writeLog({
        kind: msg.kind,
        toIntended: msg.to,
        toActual,
        ccActual,
        redirected,
        status: 'skipped',
      });
      return;
    }

    try {
      await this.transporterFor(cfg.smtp).sendMail({
        from: cfg.smtp.from,
        to: toActual,
        cc: ccActual.length > 0 ? ccActual : undefined,
        ...envelope,
      });
    } catch (e) {
      await this.writeLog({
        kind: msg.kind,
        toIntended: msg.to,
        toActual,
        ccActual,
        redirected,
        status: 'failed',
        error: String(e),
      });
      throw e;
    }

    await this.writeLog({
      kind: msg.kind,
      toIntended: msg.to,
      toActual,
      ccActual,
      redirected,
      status: 'sent',
    });

    this.logger.log(
      redirected
        ? `ส่ง ${msg.kind} ของ ${maskEmail(msg.to)} ไปที่ ${maskEmail(toActual)} (โหมด DEV)`
        : `ส่ง ${msg.kind} ไปที่ ${maskEmail(msg.to)} แล้ว`,
    );
  }

  /**
   * ★ ห้ามเก็บเนื้อเมล ★ ตารางนี้เก็บแค่ปลายทางกับผลลัพธ์ — เนื้อเมลรีเซ็ตรหัสผ่าน
   * มีลิงก์ที่ตั้งรหัสผ่านของบัญชีได้ ถ้าลงตาราง = ใครอ่าน DB ได้ก็ยึดบัญชีได้ทันที
   */
  private async writeLog(row: {
    kind: string;
    toIntended: string;
    toActual: string;
    ccActual: string[];
    redirected: boolean;
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
  }): Promise<void> {
    try {
      await this.prisma.emailLog.create({
        data: {
          kind: row.kind,
          toIntended: row.toIntended,
          toActual: row.toActual,
          ccActual: row.ccActual.length > 0 ? row.ccActual.join(', ') : null,
          redirected: row.redirected,
          status: row.status,
          // CHECK `email_logs_error_consistent` บังคับว่าเหตุผลต้องมาคู่กับ failed เสมอ
          error:
            row.status === 'failed'
              ? (row.error ?? 'ไม่ทราบสาเหตุ').slice(0, 500)
              : null,
        },
      });
    } catch (e) {
      this.logger.error(`บันทึก email log ไม่สำเร็จ: ${String(e)}`);
    }
  }

  private logUnconfigured(to: string, hint?: string): void {
    // ★ เช็ค NODE_ENV ซ้ำตรงนี้เอง ไม่ฝากไว้กับ env.ts ★
    // `env.ts` บังคับให้ตั้ง SMTP เมื่อ NODE_ENV=production อยู่แล้ว แต่ถ้าวันหนึ่ง
    // มีคนรัน production โดยไม่ได้ตั้ง NODE_ENV (ค่า default คือ 'development')
    // ด่านนั้นจะถูกข้ามไปเงียบ ๆ แล้วบรรทัดล่างจะเขียน **กุญแจของบัญชี** ลง log
    // — log เป็นที่ที่คนเข้าถึงได้ง่ายกว่ากล่องเมลของเจ้าของบัญชีมาก
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(
        `ยังไม่ได้ตั้ง SMTP — ส่งอีเมลไม่ได้ และไม่พิมพ์ลิงก์ลง log บน production (${maskEmail(to)})`,
      );
      return;
    }
    this.logger.warn(
      `ยังไม่ได้ตั้ง SMTP — ไม่ได้ส่งอีเมลจริง${hint ? ` · ลิงก์ของ ${to}: ${hint}` : ` (${to})`}`,
    );
  }

  private transporterFor(
    smtp: NonNullable<EffectiveMailConfig['smtp']>,
  ): Transporter {
    const key = JSON.stringify(smtp);
    if (this.cached?.key !== key) {
      this.cached = {
        key,
        transporter: nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          /**
           * ★ ไม่ยอมส่งแบบไม่เข้ารหัสเด็ดขาด ★
           * ค่า default ของ nodemailer เมื่อ `secure: false` คือ "อัปเกรดเป็น TLS
           * ถ้าเซิร์ฟเวอร์รองรับ" — แปลว่าเซิร์ฟเวอร์ที่ไม่ประกาศ STARTTLS จะทำให้
           * เมลถูกส่งเป็น plaintext **เงียบ ๆ** และสิ่งที่อยู่ในเมลฉบับนี้คือลิงก์ที่
           * ตั้งรหัสผ่านของบัญชีได้ · ตั้ง `requireTLS` แล้วมันจะ throw แทนที่จะส่ง
           * (พอร์ต 465 ที่ `secure: true` เข้ารหัสตั้งแต่เชื่อมต่ออยู่แล้ว ค่านี้ไม่กวน)
           */
          requireTLS: true,
          auth: smtp.user
            ? { user: smtp.user, pass: smtp.pass ?? '' }
            : undefined,
        }),
      };
    }
    return this.cached.transporter;
  }
}

/** log ไม่ใช่ที่เก็บอีเมลเต็ม ๆ ของผู้ใช้ — พอให้ไล่ปัญหาได้ว่าใบไหนไปไหน */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

function redirectBannerText(intended: string): string {
  return [
    '──────────────────────────────',
    'โหมดทดสอบ (DEV) — อีเมลฉบับนี้ถูกเปลี่ยนเส้นทางมาที่กล่องนี้',
    `ผู้รับตัวจริงคือ: ${intended}`,
    'ถ้าคุณเห็นข้อความนี้บนระบบจริง แปลว่ามีคนเปิดโหมดทดสอบค้างไว้',
    '──────────────────────────────',
  ].join('\n');
}

function redirectBannerHtml(intended: string): string {
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#FFF7E6;border:1px solid #E0A800;border-left-width:4px;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:14px;line-height:1.6;color:#6B4E00">
  <strong>โหมดทดสอบ (DEV)</strong> — อีเมลฉบับนี้ถูกเปลี่ยนเส้นทางมาที่กล่องนี้<br>
  ผู้รับตัวจริงคือ <strong>${escapeHtml(intended)}</strong><br>
  <span style="font-size:13px">ถ้าคุณเห็นข้อความนี้บนระบบจริง แปลว่ามีคนเปิดโหมดทดสอบค้างไว้</span>
</div>`;
}

function passwordResetText(url: string, minutes: number): string {
  return [
    'มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชี ANAN ที่ผูกกับอีเมลนี้',
    '',
    `เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ ${minutes} นาที และใช้ได้ครั้งเดียว):`,
    url,
    '',
    'ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร — รหัสผ่านเดิมยังใช้ได้ตามปกติ',
    'และอย่าส่งลิงก์นี้ต่อให้ใคร ใครที่เปิดลิงก์ได้จะตั้งรหัสผ่านของบัญชีนี้ได้',
  ].join('\n');
}

function passwordResetHtml(url: string, minutes: number): string {
  // ไม่มี asset ภายนอก ไม่มีรูป ไม่มีสคริปต์ — โปรแกรมเมลส่วนใหญ่บล็อกอยู่แล้ว
  // และเมลที่อ่านได้ทั้งแบบ text ล้วนคือเมลที่ไม่พึ่งการโหลดอะไรเพิ่ม
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#2B2620">
  <p>มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชี <strong>ANAN</strong> ที่ผูกกับอีเมลนี้</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(url)}"
       style="background:#1F4A3C;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">
      ตั้งรหัสผ่านใหม่
    </a>
  </p>
  <p>ลิงก์นี้ใช้ได้ <strong>${minutes} นาที</strong> และใช้ได้ครั้งเดียว</p>
  <p style="color:#6E675E;font-size:13px">
    ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร — รหัสผ่านเดิมยังใช้ได้ตามปกติ<br>
    อย่าส่งลิงก์นี้ต่อให้ใคร ใครที่เปิดลิงก์ได้จะตั้งรหัสผ่านของบัญชีนี้ได้
  </p>
  <p style="color:#6E675E;font-size:13px">เปิดลิงก์ไม่ได้? คัดลอกที่อยู่นี้ไปวางในเบราว์เซอร์:<br>${escapeHtml(url)}</p>
</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
