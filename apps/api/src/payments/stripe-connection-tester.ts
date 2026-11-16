import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';

import { isStripeTestKey } from '../integrations/connection-mode';
import { ConnectionTestRegistry, type ConnectionTester } from '../integrations/connection-tester';

/** Registers itself with ConnectionTestRegistry on boot so the tenant-facing
 * "Test connection" button actually authenticates against real Stripe for
 * STRIPE connections, instead of the "not available yet" fallback. */
@Injectable()
export class StripeConnectionTester implements ConnectionTester, OnModuleInit {
  readonly provider = 'STRIPE' as const;

  constructor(@Inject(ConnectionTestRegistry) private readonly registry: ConnectionTestRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async test(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    const secretKey = credentials.secretKey?.trim();
    if (!secretKey) return { ok: false, message: 'secretKey is required.' };
    if (!isStripeTestKey(secretKey))
      return {
        ok: false,
        message: 'Only a Stripe test-mode key (sk_test_ or rk_test_) may be used at this stage.',
      };

    try {
      await new Stripe(secretKey).balance.retrieve();
      return { ok: true, message: 'Connected to Stripe successfully.' };
    } catch {
      return { ok: false, message: 'Stripe authentication failed.' };
    }
  }
}
