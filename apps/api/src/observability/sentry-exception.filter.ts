import { Catch, HttpException, type HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { ArgumentsHost } from '@nestjs/common';

import { reportOperationalFailure } from './error-tracking';

/** Captures unexpected HTTP failures without turning expected 4xx responses into alerts. */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  constructor(applicationRef: HttpServer) {
    super(applicationRef);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const request = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
      reportOperationalFailure(exception, {
        component: 'api',
        operation: `${request.method ?? 'UNKNOWN'} ${request.url ?? 'unknown'}`,
      });
    }
    super.catch(exception, host);
  }
}
