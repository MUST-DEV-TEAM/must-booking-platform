import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@must/shared-types';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { Public } from '../tenancy/tenant-context.decorator';

@Public()
@Controller('health')
export class HealthController {
  constructor(@InjectPinoLogger(HealthController.name) private readonly logger: PinoLogger) {}

  @Get()
  getHealth(): HealthStatus {
    this.logger.info('Health check requested');

    return { status: 'ok' };
  }
}
