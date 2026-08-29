import type { User } from '@prisma/client';

/**
 * รูปแบบ user ที่ส่งออกไปหา client
 *
 * ★ ห้าม return entity ของ Prisma ตรง ๆ ★ (CLAUDE.md กฎข้อ 7)
 * ถ้าส่งดิบ `passwordHash` จะหลุดออกไปทันที และเวลาเพิ่มคอลัมน์ใหม่ในอนาคต
 * มันจะไหลออก API เองโดยไม่มีใครตัดสินใจ — ที่นี่คือจุดที่ตัดสินใจนั้นถูกบันทึกไว้
 */
export interface UserResponse {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  avatarUrl: string | null;
  isSeller: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    isSeller: user.isSeller,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
  };
}
