import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { corsOrigins, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  configureApp(app, {
    corsOrigins: corsOrigins(config.get('CORS_ORIGINS', { infer: true })),
  });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  // bind 0.0.0.0 เพื่อให้ Expo Go บนมือถือในวง LAN เดียวกันเรียกได้
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`ANAN API → http://localhost:${port}/api/v1`);
}

void bootstrap();
