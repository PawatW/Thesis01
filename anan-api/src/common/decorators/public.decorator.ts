import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * เปิดให้เรียกได้โดยไม่ต้องล็อกอิน
 *
 * ระบบตั้ง `JwtAuthGuard` เป็น global guard — ทุก endpoint ต้องมี token
 * โดยปริยาย แล้วค่อยเปิดเป็นรายจุดด้วย decorator นี้
 *
 * ทำไมกลับด้าน: บทเรียนจากสถาปัตยกรรมเดิม — endpoint ที่ "ลืมใส่ guard"
 * จะหลุดเงียบ ๆ โดยไม่มีอะไรเตือน แต่ endpoint ที่ "ลืมใส่ @Public()"
 * จะพังทันทีตอนทดสอบ (ดู docs/security-design.md)
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
