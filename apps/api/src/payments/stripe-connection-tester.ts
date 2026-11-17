import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';

import { connectionMode, isStripeTestKey } from '../integrations/connection-mode';
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

    // The publishable key is optional (it lets the website show Stripe's checkout inside its page); when
    // saved it must be a publishable key of the same mode as the secret key.
    const publishableKey = credentials.publishableKey?.trim();
    if (publishableKey) {
      const publishableMode = /^pk_test_/.test(publishableKey)
        ? 'TEST'
        : /^pk_live_/.test(publishableKey)
          ? 'LIVE'
          : null;
      if (!publishableMode)
        return { ok: false, message: 'The publishable key must start with pk_test_ or pk_live_.' };
      if (publishableMode !== connectionMode('STRIPE', { secretKey }))
        return {
          ok: false,
          message: 'The publishable key and the secret key must both be test or both be live.',
        };
    }

    try {
      await new Stripe(secretKey).balance.retrieve();
      return { ok: true, message: 'Connected to Stripe successfully.' };
    } catch {
      return { ok: false, message: 'Stripe authentication failed.' };
    }
  }
}
