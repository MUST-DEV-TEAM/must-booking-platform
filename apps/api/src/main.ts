import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { PublicCorsService } from './tenancy/public-cors.service';

type CorsRequest = { headers: { origin?: string | string[] }; path: string; method: string };
type CorsResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { end(): void };
};

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
  const publicCors = app.get(PublicCorsService);

  app.useLogger(app.get(Logger));

  app.use(async (request: CorsRequest, response: CorsResponse, next: () => void) => {
    const origin = request.headers.origin;
    const match = request.path.match(
      /^\/tenants\/([^/]+)\/properties\/([^/]+)\/(?:public\/(?:availability|catalog|bookings\/[^/]+)|quotes|bookings(?:\/[^/]+)?)$/,
    );
    if (
      typeof origin !== 'string' ||
      !match ||
      !(await publicCors.allows(match[1], match[2], origin))
    ) {
      next();
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  });

  await app.listen(configService.getOrThrow<number>('APP_PORT'));
}

void bootstrap();
