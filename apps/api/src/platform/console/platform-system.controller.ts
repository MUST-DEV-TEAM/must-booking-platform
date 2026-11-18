import { Controller, Get, Inject } from '@nestjs/common';

import { ClockDeadLetterMonitorService } from '../../integrations/clock/clock-dead-letter-monitor.service';
import { ClockQueueService } from '../../integrations/clock/clock-queue.service';
import { PlatformCapability, PlatformConsole } from './platform-console.decorators';

/** Read-only health of the background work behind the Clock connections. */
@PlatformConsole()
@Controller('platform-console/system')
export class PlatformSystemController {
  constructor(
    @Inject(ClockQueueService) private readonly queues: ClockQueueService,
    @Inject(ClockDeadLetterMonitorService)
    private readonly monitor: ClockDeadLetterMonitorService,
  ) {}

  /** Jobs that failed for good and wait on the dead-letter queue, and how long the oldest has waited. */
  @Get('dead-letter')
  @PlatformCapability('platform.connections.view')
  async deadLetter() {
    return {
      ...(await this.queues.deadLetterStats()),
      alertedCount: await this.monitor.alertedCount(),
    };
  }
}
