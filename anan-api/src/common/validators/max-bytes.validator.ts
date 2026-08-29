import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * จำกัดความยาวเป็น **ไบต์** ไม่ใช่จำนวนตัวอักษร
 *
 * ทำไมต้องมี: `@MaxLength` นับ UTF-16 code unit แต่ bcrypt ตัดข้อความทิ้งที่
 * 72 **ไบต์** ภาษาไทย 1 ตัว = 3 ไบต์ใน UTF-8 → รหัสผ่านไทย 30 ตัวจะถูกใช้จริง
 * แค่ 24 ตัวแรก ส่วนที่เหลือไม่มีผลต่อการล็อกอินเลย โดยที่ผู้ใช้ไม่มีทางรู้
 */
export function MaxBytes(max: number, options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'maxBytes',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'string') return false;
          return (
            Buffer.byteLength(value, 'utf8') <= (args.constraints[0] as number)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `ยาวเกินกำหนด (สูงสุด ${args.constraints[0] as number} ไบต์ — ภาษาไทย 1 ตัวนับเป็น 3)`;
        },
      },
    });
  };
}
