import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';

import { validateEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        customAttributeKeys: {
          req: 'request',
          res: 'response',
          responseTime: 'duration',
        },
        genReqId: (request) => {
          const requestId = request.headers['x-request-id'];

          return typeof requestId === 'string' && requestId.trim() !== ''
            ? requestId
            : randomUUID();
        },
        serializers: {
          req: (request: IncomingMessage & { id?: string }) => ({
            id: request.id,
            method: request.method,
            path: request.url,
          }),
          res: (response: ServerResponse) => ({
            statusCode: response.statusCode,
          }),
        },
      },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
