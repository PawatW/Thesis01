import { z } from 'zod';

/**
 * ตรวจ env ตอนบูต ไม่ใช่ตอนใช้งาน — ถ้าค่าหาย แอปต้องไม่ขึ้นเลย
 * ดีกว่าไปพังตอน request แรกที่ผู้ใช้จริงยิงเข้ามา
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL ว่าง — ดู .env.example'),

    // 48 bytes base64url = 64 ตัวอักษร; กันการเผลอใส่ค่าสั้น ๆ ที่ brute-force ได้
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET สั้นเกินไป'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET สั้นเกินไป'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),

    CORS_ORIGINS: z.string().default('http://localhost:8081'),

    /**
     * `SameSite` ของ cookie ที่ถือ refresh token ของฝั่งเว็บ
     *
     * `lax` (ค่าเริ่มต้น) พอสำหรับทุกกรณีที่หน้าจอกับ API อยู่ "site" เดียวกัน —
     * รวมถึงตอนพัฒนา (`localhost:8081` → `localhost:3000`: คนละพอร์ตแต่ site
     * เดียวกัน เพราะพอร์ตไม่นับเป็นส่วนหนึ่งของ site) และตอน deploy ที่
     * `app.example.com` → `api.example.com` · ค่านี้ทำให้ CSRF เป็นไปไม่ได้เลย
     * เพราะเบราว์เซอร์ไม่แนบ cookie ไปกับ POST ข้าม site ตั้งแต่แรก
     *
     * ต้องเปลี่ยนเป็น `none` ก็ต่อเมื่อหน้าจอกับ API อยู่คนละโดเมนจริง ๆ
     * (เช่น `anan.vercel.app` → `anan-api.onrender.com`) ซึ่งเปิดช่อง CSRF กลับมา
     * — `AllowedOriginGuard` จึงเป็นด่านที่ปิดช่องนั้นแทน ไม่ใช่ `SameSite`
     */
    REFRESH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    /**
     * ที่อยู่ของ "แอป" ในสายตาผู้ใช้ — ใช้ประกอบลิงก์ที่ส่งออกไปทางอีเมล
     * ต้องเป็นของฝั่งหน้าจอ (Expo web) ไม่ใช่ของ API เพราะคนกดลิงก์ต้องได้หน้าจอ
     */
    APP_WEB_URL: z.string().url().default('http://localhost:8081'),

    /**
     * SMTP สำหรับอีเมลขาออก (ตอนนี้มีที่เดียวคือลิงก์รีเซ็ตรหัสผ่าน)
     *
     * ทั้งชุดเป็น optional เพื่อให้เครื่องพัฒนาที่ยังไม่ได้ตั้งค่าบูตได้ —
     * `MailService` จะพิมพ์ลิงก์ลง log แทนการส่งจริง · แต่ `.superRefine`
     * ข้างล่างบังคับให้ครบเมื่อ NODE_ENV=production เพราะบน production
     * การ "ส่งเมลไม่ออกแบบเงียบ ๆ" แปลว่าผู้ใช้กู้บัญชีไม่ได้เลย
     */
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    /** true = TLS ตั้งแต่เชื่อมต่อ (พอร์ต 465) · false = STARTTLS (พอร์ต 587) */
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    /** ผู้ส่งที่ผู้ใช้เห็น เช่น `ANAN <no-reply@anan.local>` */
    MAIL_FROM: z.string().optional(),

    /**
     * เปิดความสามารถสำหรับการนำเสนอเท่านั้น — ตอนนี้คือ time-travel ของ engine
     * (สั่งให้สร้างออเดอร์ด้วยวันที่จำลอง) ค่า default เป็น 'false' และยังต้อง
     * ผ่าน allowlist ของ NODE_ENV อีกชั้นที่ EngineController
     */
    DEMO_MODE: z.enum(['true', 'false']).default('false'),

    /**
     * ยอมให้ผู้ดูแล **เปิดโหมดเปลี่ยนเส้นทางอีเมล (DEV/UAT)** จากหน้าจอได้ไหม
     *
     * ★ ด่านนี้อยู่ที่เครื่อง ไม่ใช่ที่สิทธิ์ผู้ใช้ โดยตั้งใจ ★ การเปลี่ยนเส้นทางอีเมล
     * ทั้งระบบบน production แปลว่าผู้ใช้จริงไม่ได้รับลิงก์กู้บัญชีอีกเลย และคนที่ถือ
     * ปลายทางนั้นได้ลิงก์ของ **ทุกคน** แทน — เป็น account takeover ทั้งระบบในคลิกเดียว
     * บัญชี admin ที่ถูกยึดจึงต้องทำแบบนี้ไม่ได้ ต่อให้ล็อกอินสำเร็จ
     *
     * `MailSettingsService` ยังบวกเงื่อนไข `NODE_ENV !== 'production'` ทับอีกชั้น
     */
    MAIL_UAT_MODE_AVAILABLE: z.enum(['true', 'false']).default('false'),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
  })
  // secret เดียวกันทั้งสองตัว = refresh token ใช้แทน access token ได้ทันที
  .refine((v) => v.JWT_ACCESS_SECRET !== v.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET กับ JWT_REFRESH_SECRET ต้องไม่ใช่ค่าเดียวกัน',
    path: ['JWT_REFRESH_SECRET'],
  })
  /**
   * บน production เมลต้องส่งได้จริง — ตรวจตอนบูตเหมือนค่าอื่นในไฟล์นี้
   * ดีกว่ารู้ตอนที่ผู้ใช้คนแรกกด "ลืมรหัสผ่าน" แล้วไม่มีอะไรเกิดขึ้น
   */
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return;
    for (const key of ['SMTP_HOST', 'MAIL_FROM'] as const) {
      if (!v[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} ต้องมีค่าเมื่อ NODE_ENV=production (ใช้ส่งลิงก์รีเซ็ตรหัสผ่าน)`,
        });
      }
    }
  })
  /**
   * `SameSite=None` บังคับให้ cookie ต้องมี `Secure` ตามสเปกของเบราว์เซอร์ ซึ่ง
   * แปลว่าต้องเสิร์ฟผ่าน HTTPS · ตั้งค่านี้บนเครื่องพัฒนาที่รัน http แล้วเบราว์เซอร์
   * จะ **ทิ้ง cookie เงียบ ๆ** — อาการที่เห็นคือ "ล็อกอินแล้วแต่รีเฟรชทีไรก็หลุด"
   * ซึ่งไล่หาสาเหตุยากมากเพราะไม่มี error ที่ไหนเลย · กันไว้ตั้งแต่ตอนบูตดีกว่า
   */
  .refine(
    (v) => v.REFRESH_COOKIE_SAMESITE !== 'none' || v.NODE_ENV === 'production',
    {
      message:
        'REFRESH_COOKIE_SAMESITE=none ใช้ได้เฉพาะ NODE_ENV=production (ต้องมี Secure = ต้องเป็น HTTPS)',
      path: ['REFRESH_COOKIE_SAMESITE'],
    },
  );

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.')}: ${i.message}`,
    );
    throw new Error(`ค่าใน .env ไม่ถูกต้อง\n${lines.join('\n')}`);
  }
  return parsed.data;
}

/** origin ที่อนุญาตให้เรียก API — คั่นด้วย comma ใน env */
export function corsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
