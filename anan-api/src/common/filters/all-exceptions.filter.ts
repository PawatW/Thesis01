import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ApiErrorBody } from '../errors/app-exception';

/**
 * ด่านสุดท้ายก่อน error ออกจากระบบ — ทุก error ต้องออกในรูปแบบเดียวกัน
 *
 * เหตุผลด้านความปลอดภัย: error ที่ไม่ได้จัดรูปจะพ่น stack trace, ชื่อตาราง,
 * และ constraint name ให้ client ซึ่งเป็นแผนที่ของฐานข้อมูลให้ผู้โจมตีฟรี ๆ
 * ที่นี่จึง log ของจริงไว้ฝั่ง server แล้วส่งข้อความกลาง ๆ กลับไป
 */
const BAD_REQUEST: number = HttpStatus.BAD_REQUEST;

/** ข้อความไทยประจำ status — ไม่สะท้อน path หรือข้อความภายในกลับไปหา client */
const STATUS_FALLBACK: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_FAILED', message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' },
  401: { code: 'UNAUTHENTICATED', message: 'กรุณาเข้าสู่ระบบ' },
  403: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' },
  404: { code: 'NOT_FOUND', message: 'ไม่พบข้อมูลที่ต้องการ' },
  409: { code: 'CONFLICT', message: 'สถานะปัจจุบันทำรายการนี้ไม่ได้' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป' },
  415: { code: 'UNSUPPORTED_MEDIA', message: 'ชนิดข้อมูลนี้ไม่รองรับ' },
  422: { code: 'BUSINESS_RULE', message: 'ทำรายการไม่ได้ตามเงื่อนไขของระบบ' },
  429: { code: 'RATE_LIMITED', message: 'เรียกใช้งานถี่เกินไป กรุณารอสักครู่' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (body.code === 'DATA_RULE_VIOLATION') {
      // ชน CHECK ที่ DB = ชั้น DTO/service ข้างบนมีรู ต้องส่งเสียง ไม่ใช่เงียบ
      this.logger.warn(
        `${req.method} ${req.url} → 422 ${body.code}: ${
          exception instanceof Error ? exception.message : ''
        }`,
      );
    }

    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    // 1) AppException — จัดรูปมาแล้ว
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();

      if (this.isApiErrorBody(resp)) return resp;

      // 2) exception มาตรฐานของ Nest (ValidationPipe, route ไม่มีจริง, throttler)
      //    ข้อความจาก framework เป็นอังกฤษและบางทีสะท้อน path กลับไป
      //    จึงแทนด้วยข้อความไทยกลาง ๆ — service ที่ต้องการข้อความเฉพาะ
      //    ต้องใช้ AppError.* ซึ่งเข้าทางที่ (1) ข้างบน
      const fallback = STATUS_FALLBACK[status] ?? {
        code: 'HTTP_ERROR',
        message: 'เกิดข้อผิดพลาด',
      };

      if (status === BAD_REQUEST && typeof resp === 'object' && resp !== null) {
        const raw = resp as { message?: unknown };
        const detail = Array.isArray(raw.message)
          ? raw.message.join(' · ')
          : typeof raw.message === 'string'
            ? raw.message
            : undefined;
        return {
          statusCode: status,
          code: fallback.code,
          // รายละเอียดของ validation มาจาก DTO ของเราเอง จึงปลอดภัยที่จะส่งกลับ
          message: `${fallback.message}${detail ? ` (${detail})` : ''}`,
        };
      }

      return { statusCode: status, ...fallback };
    }

    // 3) Prisma — แปลงเป็นภาษาคน ไม่ปล่อยชื่อ constraint ออกไป
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': // unique violation
          return {
            statusCode: HttpStatus.CONFLICT,
            code: 'DUPLICATE',
            message: 'ข้อมูลนี้มีอยู่แล้ว',
          };
        case 'P2003': // FK violation
          return {
            statusCode: HttpStatus.BAD_REQUEST,
            code: 'INVALID_REFERENCE',
            message: 'ข้อมูลที่อ้างถึงไม่มีอยู่จริง',
          };
        case 'P2025': // record not found
          return {
            statusCode: HttpStatus.NOT_FOUND,
            code: 'NOT_FOUND',
            message: 'ไม่พบข้อมูลที่ต้องการ',
          };
      }
    }

    // CHECK constraint ที่ DB ปฏิเสธ = กฎที่ DTO/service ควรกันไว้ก่อนแล้ว
    // ตอบ 422 แล้ว log warn (ดูข้างบน) เพราะถือเป็นสัญญาณว่าชั้นบนมีรู
    if (
      exception instanceof Prisma.PrismaClientUnknownRequestError &&
      exception.message.includes('violates check constraint')
    ) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'DATA_RULE_VIOLATION',
        message: 'ข้อมูลไม่ผ่านกฎของระบบ',
      };
    }

    // PrismaClientValidationError = "เราประกอบ query ผิดเอง" (ชนิดข้อมูลไม่ตรง,
    // ส่ง null ให้คอลัมน์ NOT NULL) ไม่ใช่ความผิดของข้อมูลที่ผู้ใช้กรอก
    // ต้องเป็น 500 + log ให้เห็น ไม่ใช่ 422 ที่ทำให้ bug ของเราเงียบไปเฉย ๆ
    // (deadlock / serialization failure ตกลงมาที่ default ข้างล่างด้วยเหตุผลเดียวกัน)

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'เกิดข้อผิดพลาดภายในระบบ',
    };
  }

  private isApiErrorBody(v: unknown): v is ApiErrorBody {
    return (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as ApiErrorBody).code === 'string' &&
      typeof (v as ApiErrorBody).message === 'string' &&
      typeof (v as ApiErrorBody).statusCode === 'number'
    );
  }
}
