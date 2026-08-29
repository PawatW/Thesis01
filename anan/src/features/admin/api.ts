/**
 * ชั้นข้อมูลของผู้ดูแลแพลตฟอร์ม (feature 14 · W10)
 *
 * ★ หน้าจอฝั่งนี้ไม่ได้ให้สิทธิ์อะไรเลย ★ การซ่อนเมนูในโปรไฟล์เป็น UX เท่านั้น —
 * ทุก endpoint ในไฟล์นี้ตอบ 403 ถ้า token ไม่ใช่ของ admin ไม่ว่าจะเรียกจากที่ไหน
 */

import { ApiError, apiFetch } from '@/lib/api/client';

export type AdminStats = {
  users: number;
  shops: number;
  suspendedShops: number;
  products: number;
  activeSubscriptions: number;
  ordersToday: number;
  mrr: number;
  cancelledThisMonth: number;
  openIssues: number;
};

export type AdminCategory = {
  id: number;
  name: string;
  icon: string | null;
  sortOrder: number;
  productCount: number;
};

export type AdminShop = {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  productCount: number;
  activeSubscribers: number;
  openIssues: number;
  cancelledOrders30d: number;
  createdAt: string;
};

export type AdminProduct = {
  id: string;
  name: string;
  shopId: string;
  shopName: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  activeSubscribers: number;
  createdAt: string;
};

export type SuspensionResult = {
  id: string;
  name: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  affectedSubscriptions: number;
};

export type AdminIssue = {
  id: string;
  orderId: string;
  type: string;
  detail: string;
  status: string;
  shopId: string;
  shopName: string;
  productName: string;
  ageDays: number;
  createdAt: string;
  resolvedAt: string | null;
};

export type EngineRun = {
  id: number;
  runDate: string;
  ordersCreated: number;
  notificationsCreated: number;
  detail: {
    due: number;
    skipped: number;
    upcoming: number;
    shopsNotified: number;
    tokensPurged: number;
    autoConfirmed: number;
    paymentsFailed: number;
    failed: number;
  };
  ranAt: string;
};

/* ---------------- ตั้งค่าเมล + log ระบบ ---------------- */

export type MailSettings = {
  redirectEnabled: boolean;
  redirectTo: string | null;
  redirectCc: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  mailFrom: string | null;
  updatedAt: string;
  /**
   * เครื่องนี้อนุญาตให้เปิดโหมด DEV ไหม — หน้าจอใช้ปิดสวิตช์และอธิบายเหตุผล
   * **ไม่ใช่ด่าน**: API ปฏิเสธเองอยู่แล้วถ้ายิงตรงมาโดยที่ env ไม่เปิด
   */
  uatModeAvailable: boolean;
  /** `.env` มี SMTP ครบไหม — false = เมลถูกบันทึกลง log แทนการส่งจริง */
  smtpConfigured: boolean;
};

export type MailSettingsInput = {
  redirectEnabled: boolean;
  redirectTo: string;
  redirectCc: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  mailFrom: string | null;
};

export type AuditAction =
  | 'shop_suspended'
  | 'shop_unsuspended'
  | 'product_suspended'
  | 'product_unsuspended'
  | 'category_created'
  | 'category_updated'
  | 'category_deleted'
  | 'mail_settings_updated'
  | 'engine_run_manual'
  | 'password_reset_completed';

export type AuditLogRow = {
  id: number;
  action: AuditAction;
  summary: string;
  /** null = ระบบทำเอง หรือบัญชีที่ทำถูกลบไปแล้ว */
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
};

export type EmailLogStatus = 'sent' | 'failed' | 'skipped';

export type EmailLogRow = {
  id: number;
  kind: string;
  toIntended: string;
  toActual: string;
  ccActual: string | null;
  redirected: boolean;
  status: EmailLogStatus;
  error: string | null;
  createdAt: string;
};

export type Paged<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type Result<T> = { data: T; error: null } | { data: null; error: string };

async function call<T>(
  path: string,
  init?: { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown },
): Promise<Result<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method: init?.method ?? 'GET',
      ...(init?.body === undefined ? {} : { body: init.body }),
    });
    return { data, error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่',
    };
  }
}

export const getStats = (): Promise<Result<AdminStats>> =>
  call<AdminStats>('/admin/stats');

/* ---------------- หมวดสินค้า ---------------- */

export const listCategories = (): Promise<Result<AdminCategory[]>> =>
  call<AdminCategory[]>('/admin/categories');

export const createCategory = (input: {
  name: string;
  icon?: string;
  sortOrder?: number;
}): Promise<Result<AdminCategory>> =>
  call<AdminCategory>('/admin/categories', { method: 'POST', body: input });

export const updateCategory = (
  id: number,
  input: { name?: string; icon?: string; sortOrder?: number },
): Promise<Result<AdminCategory>> =>
  call<AdminCategory>(`/admin/categories/${id}`, {
    method: 'PATCH',
    body: input,
  });

export const removeCategory = (id: number): Promise<Result<void>> =>
  call<void>(`/admin/categories/${id}`, { method: 'DELETE' });

/* ---------------- moderation ---------------- */

export const listShops = (q: string): Promise<Result<AdminShop[]>> =>
  call<AdminShop[]>(`/admin/shops${q === '' ? '' : `?q=${encodeURIComponent(q)}`}`);

export const listProducts = (q: string): Promise<Result<AdminProduct[]>> =>
  call<AdminProduct[]>(
    `/admin/products${q === '' ? '' : `?q=${encodeURIComponent(q)}`}`,
  );

/** ระงับ/คืนสถานะ — ไม่ส่งเวลาขึ้นไป เวลาที่ระงับเป็นของ server เสมอ */
export const setShopSuspension = (
  id: string,
  suspend: boolean,
  reason?: string,
): Promise<Result<SuspensionResult>> =>
  call<SuspensionResult>(`/admin/shops/${id}/suspension`, {
    method: 'POST',
    body: reason === undefined ? { suspend } : { suspend, reason },
  });

export const setProductSuspension = (
  id: string,
  suspend: boolean,
  reason?: string,
): Promise<Result<SuspensionResult>> =>
  call<SuspensionResult>(`/admin/products/${id}/suspension`, {
    method: 'POST',
    body: reason === undefined ? { suspend } : { suspend, reason },
  });

export const listIssues = (
  status: 'open' | 'closed',
): Promise<Result<AdminIssue[]>> =>
  call<AdminIssue[]>(`/admin/issues?status=${status}`);

/* ---------------- engine ---------------- */

export const listEngineRuns = (): Promise<Result<EngineRun[]>> =>
  call<EngineRun[]>('/admin/engine/runs');

/** เว้น runDate = วันนี้ · ใส่วันที่ = time-travel (API เปิดให้เฉพาะเครื่องเดโม่) */
export const runEngine = (runDate?: string): Promise<Result<EngineRun>> =>
  call<EngineRun>('/admin/engine/run', {
    method: 'POST',
    body: runDate === undefined || runDate === '' ? {} : { runDate },
  });

/* ---------------- ตั้งค่าเมล ---------------- */

export const getMailSettings = (): Promise<Result<MailSettings>> =>
  call<MailSettings>('/admin/mail-settings');

/**
 * ส่งค่าทั้งชุดเสมอ (PUT ไม่ใช่ PATCH) — ถ้าส่งบางช่อง ฝั่ง server จะแยกไม่ออก
 * ระหว่าง "ปิดโหมด" กับ "ไม่ได้แตะโหมด"
 */
export const saveMailSettings = (
  input: MailSettingsInput,
): Promise<Result<MailSettings>> =>
  call<MailSettings>('/admin/mail-settings', { method: 'PUT', body: input });

/* ---------------- log ระบบ ---------------- */

export const listAuditLogs = (opts: {
  page: number;
  action?: AuditAction | '';
}): Promise<Result<Paged<AuditLogRow>>> =>
  call<Paged<AuditLogRow>>(
    `/admin/logs/audit?page=${opts.page}${opts.action ? `&action=${opts.action}` : ''}`,
  );

export const listEmailLogs = (opts: {
  page: number;
  status?: EmailLogStatus | '';
}): Promise<Result<Paged<EmailLogRow>>> =>
  call<Paged<EmailLogRow>>(
    `/admin/logs/email?page=${opts.page}${opts.status ? `&status=${opts.status}` : ''}`,
  );
