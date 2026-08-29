import { SetMetadata } from '@nestjs/common';

export type Role = 'seller' | 'admin';
export const ROLES_KEY = 'roles';

/**
 * จำกัดให้เฉพาะ role ที่กำหนด (ใช้คู่กับ RolesGuard)
 *
 * ขอบเขตของ role: บอกได้แค่ว่า "เป็นผู้ขาย/ผู้ดูแล" — ไม่ได้บอกว่า
 * เป็นเจ้าของข้อมูลชิ้นที่กำลังจะแก้ การเช็คความเป็นเจ้าของยังต้องทำใน
 * service ผ่าน where clause เสมอ (docs/security-design.md ชั้น L3)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
