import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { ConnectionTestRegistry, type ConnectionTester } from '../integrations/connection-tester';

/** Registers itself with ConnectionTestRegistry on boot so the tenant-facing
 * "Test connection" button actually authenticates against real PokPay for
 * POKPAY connections, instead of the "not available yet" fallback. */
@Injectable()
export class PokpayConnectionTester implements ConnectionTester, OnModuleInit {
  readonly provider = 'POKPAY' as const;

  constructor(@Inject(ConnectionTestRegistry) private readonly registry: ConnectionTestRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async test(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    const keyId = credentials.keyId?.trim();
    const keySecret = credentials.keySecret?.trim();
    const merchantId = credentials.merchantId?.trim();
    const webhookUrl = credentials.webhookUrl?.trim();
    const baseUrl = (credentials.baseUrl?.trim() || 'https://api-staging.pokpay.io').replace(
      /\/$/,
      '',
    );
    if (!keyId || !keySecret || !merchantId || !webhookUrl)
      return { ok: false, message: 'keyId, keySecret, merchantId, and webhookUrl are required.' };
    if (baseUrl !== 'https://api-staging.pokpay.io')
      return { ok: false, message: 'Only PokPay staging may be used at this stage.' };
    try {
      new URL(webhookUrl);
    } catch {
      return { ok: false, message: 'webhookUrl must be a valid URL.' };
    }

    try {
      const login = await fetch(`${baseUrl}/auth/sdk/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId, keySecret }),
      });
      const body = (await login.json().catch(() => null)) as { data?: { accessToken?: string } } | null;
      if (!login.ok || !body?.data?.accessToken)
        return { ok: false, message: 'PokPay authentication failed.' };
      return { ok: true, message: 'Connected to PokPay successfully.' };
    } catch {
      return { ok: false, message: 'Could not reach PokPay.' };
    }
  }
}
