import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * global เพราะการกระทำที่ต้องมีร่องรอยกระจายอยู่หลายโมดูล (admin · engine · auth)
 * — ถ้าต้อง import กันเป็นทอด ๆ คนเขียน feature ใหม่จะเลือกไม่บันทึกเพราะขี้เกียจ
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
