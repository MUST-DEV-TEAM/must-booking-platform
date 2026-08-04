import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { ConnectionTestRegistry, type ConnectionTester } from '../connection-tester';
import { ClockConnectionPingService } from './clock-connection-ping';

/** Registers itself with ConnectionTestRegistry on boot so the tenant-facing
 * "Test connection" button (Task 2) actually pings real Clock for CLOCK_PMS
 * connections, instead of the "not available yet" fallback. */
@Injectable()
export class ClockConnectionTester implements ConnectionTester, OnModuleInit {
  readonly provider = 'CLOCK_PMS' as const;

  constructor(
    @Inject(ClockConnectionPingService) private readonly ping: ClockConnectionPingService,
    @Inject(ConnectionTestRegistry) private readonly registry: ConnectionTestRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  test(credentials: Record<string, string>) {
    return this.ping.ping(credentials);
  }
}
