import 'reflect-metadata';

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

type BodyCarrier = IncomingMessage & { body?: unknown };

// Amazon SNS always POSTs its webhook deliveries as `Content-Type: text/plain`
// even though the body is JSON (a well-documented AWS quirk) — Nest's default
// body parser only parses `application/json`, so without this the Clock
// webhook gateway silently never sees a real SNS payload at all (confirmed
// 2026-09-03: every genuine SNS request was rejected as "Malformed SNS
// envelope" before ClockWebhookService ever ran). Only reads the stream when
// Nest's own default parser left `body` empty, so a genuine `application/json`
// delivery (already parsed by then) is left untouched.
function parseAnyContentTypeAsJson(
  req: BodyCarrier,
  _res: ServerResponse,
  next: (err?: unknown) => void,
): void {
  const alreadyParsed =
    req.body !== undefined &&
    req.body !== null &&
    !(typeof req.body === 'object' && Object.keys(req.body as object).length === 0);
  if (alreadyParsed) {
    next();
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    try {
      req.body = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      req.body = undefined;
    }
    next();
  });
  req.on('error', next);
}

import { AppModule } from './app.module';
import { initializeErrorTracking } from './observability/error-tracking';
import { SentryExceptionFilter } from './observability/sentry-exception.filter';

function devHttpsOptions(): { key: Buffer; cert: Buffer } | undefined {
  const keyPath = process.env.DEV_HTTPS_KEY_PATH;
  const certPath = process.env.DEV_HTTPS_CERT_PATH;
  if (!keyPath || !certPath) return undefined;
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

async function bootstrap(): Promise<void> {
  initializeErrorTracking();
  const httpsOptions = devHttpsOptions();
  const app = await NestFactory.create(AppModule, { rawBody: true, httpsOptions });
  const configService = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new SentryExceptionFilter(app.getHttpAdapter()));

  // Scoped to this one route so every other route keeps Nest's default,
  // stricter application/json-only content-type matching.
  app.use('/clock-webhooks', parseAnyContentTypeAsJson);

  await app.listen(configService.getOrThrow<number>('APP_PORT'));
}

void bootstrap();
