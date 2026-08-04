import { Injectable } from '@nestjs/common';

export type ConnectionTestResult = { ok: boolean; message: string };

export interface ConnectionTester {
  readonly provider: 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
  test(credentials: Record<string, string>): Promise<ConnectionTestResult>;
}

/**
 * Per-provider connection testers register themselves here as each provider's
 * real integration lands (Clock PMS: Milestone 11 Task 6; Stripe/PokPay: the
 * Milestone 5 reopening that moves them onto tenant-owned credentials per
 * ADR-0026). Testing a provider with no registered tester yet returns a
 * clear, honest "not available" result rather than silently succeeding.
 */
@Injectable()
export class ConnectionTestRegistry {
  private readonly testers = new Map<string, ConnectionTester>();

  register(tester: ConnectionTester): void {
    this.testers.set(tester.provider, tester);
  }

  async test(
    provider: 'STRIPE' | 'POKPAY' | 'CLOCK_PMS',
    credentials: Record<string, string>,
  ): Promise<ConnectionTestResult> {
    const tester = this.testers.get(provider);
    if (!tester)
      return { ok: false, message: 'Connection testing for this provider is not available yet.' };
    return tester.test(credentials);
  }
}
