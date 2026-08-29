import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * ★ ไม่มีฟิลด์ `isAdmin` / `suspendedAt` ใน DTO ไหนของไฟล์นี้เลย ★
 * สิทธิ์ admin ตั้งผ่าน seed/SQL เท่านั้น (feature 14 · G-2) และการระงับร้าน
 * เขียนโดย service หลังตรวจ role แล้ว ไม่ใช่ค่าที่ client ส่งมาได้
 */

export class UpsertCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'ชื่อหมวดต้องยาว 1-60 ตัวอักษร' })
  name!: string;

  /** ชื่อไอคอนของ Ionicons — ไม่ใช่ URL จึงไม่ต้องกังวลเรื่องรูปภายนอก */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

/** แก้หมวด — ทุกฟิลด์เป็นตัวเลือก แต่ห้ามส่ง `undefined` ทับค่าที่ NOT NULL */
export class UpdateCategoryDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'ชื่อหมวดต้องยาว 1-60 ตัวอักษร' })
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  icon?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export interface CategoryAdminResponse {
  id: number;
  name: string;
  icon: string | null;
  sortOrder: number;
  /** จำนวนสินค้าในหมวด — ต้องเห็นก่อนกดลบ (FK restrict จะบล็อกถ้ายังมีของ) */
  productCount: number;
}

/**
 * ตัวเลขภาพรวมของแพลตฟอร์ม — **aggregate ล้วน ไม่มีแถวของผู้ใช้คนไหนเลย**
 * (ต่างจาก dashboard ของร้านตรงที่นับข้ามทุกร้าน)
 */
export interface AdminStatsResponse {
  users: number;
  shops: number;
  suspendedShops: number;
  products: number;
  activeSubscriptions: number;
  ordersToday: number;
  /** MRR จำลองรวมทุกร้าน — normalize ด้วย `cyclesPerMonth` ตัวเดียวกับที่อื่น */
  mrr: number;
  cancelledThisMonth: number;
  /** เคสปัญหาที่ยังไม่มีร้านไหนตอบ — สัญญาณว่าต้องเข้าไปดูแล */
  openIssues: number;
}
