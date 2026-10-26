import { validPokpayWebhook } from './pokpay-environment';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConnectionTestRegistry, type ConnectionTester } from '../integrations/connection-tester';
import {
  POKPAY_BASE_URL_MESSAGE,
  isAllowedPokpayBaseUrl,
  resolvePokpayBaseUrl,
  resolvePokpayWebhookUrl,
} from './pokpay-environments';

/** Registers itself with ConnectionTestRegistry on boot so the tenant-facing
 * "Test connection" button actually authenticates against real PokPay for
 * POKPAY connections, instead of the "not available yet" fallback. */
@Injectable()
export class PokpayConnectionTester implements ConnectionTester, OnModuleInit {
  readonly provider = 'POKPAY' as const;
  private readonly logger = new Logger(PokpayConnectionTester.name);

  constructor(@Inject(ConnectionTestRegistry) private readonly registry: ConnectionTestRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async test(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    const keyId = credentials.keyId?.trim();
    const keySecret = credentials.keySecret?.trim();
    const merchantId = credentials.merchantId?.trim();
    const webhookUrl = resolvePokpayWebhookUrl(credentials.webhookUrl);
    const baseUrl = resolvePokpayBaseUrl(credentials);
    if (!keyId || !keySecret || !merchantId || !webhookUrl)
      return { ok: false, message: 'keyId, keySecret, merchantId, and webhookUrl are required.' };
    if (!isAllowedPokpayBaseUrl(baseUrl)) return { ok: false, message: POKPAY_BASE_URL_MESSAGE };
    if (!validPokpayWebhook(webhookUrl, baseUrl))
      return { ok: false, message: 'Use a valid webhook URL; production requires public HTTPS.' };

    try {
      const login = await fetch(`${baseUrl}/auth/sdk/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId, keySecret }),
      });
      const rawBody = await login.text();
      const body = (() => {
        try {
          return JSON.parse(rawBody) as { data?: { accessToken?: string } };
        } catch {
          return null;
        }
      })();
      if (!login.ok || !body?.data?.accessToken) {
        this.logger.warn(`PokPay authentication failed: status=${login.status}`);
        return { ok: false, message: 'PokPay authentication failed.' };
      }
      return { ok: true, message: 'Connected to PokPay successfully.' };
    } catch {
      this.logger.warn('PokPay authentication could not be completed.');
      return { ok: false, message: 'Could not reach PokPay.' };
    }
  }
}
