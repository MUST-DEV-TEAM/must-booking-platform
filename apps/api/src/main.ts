import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

function devHttpsOptions(): { key: Buffer; cert: Buffer } | undefined {
  const keyPath = process.env.DEV_HTTPS_KEY_PATH;
  const certPath = process.env.DEV_HTTPS_CERT_PATH;
  if (!keyPath || !certPath) return undefined;
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

async function bootstrap(): Promise<void> {
  const httpsOptions = devHttpsOptions();
  const app = await NestFactory.create(AppModule, { rawBody: true, httpsOptions });
  const configService = app.get(ConfigService);

  app.useLogger(app.get(Logger));

  await app.listen(configService.getOrThrow<number>('APP_PORT'));
}

void bootstrap();
