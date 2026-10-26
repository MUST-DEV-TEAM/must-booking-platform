import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { AuditLogService, type AuditEntry } from './audit-log.service';
import { reportOperationalFailure } from '../observability/error-tracking';
vi.mock('../observability/error-tracking', () => ({ reportOperationalFailure: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
async function capture(entry: Partial<AuditEntry> = {}) {
  const execute = vi.fn().mockResolvedValue(1);
  await new AuditLogService({} as never).recordInTransaction({ $executeRaw: execute } as never, {
    tenantId: 'tenant',
    propertyId: 'property',
    actorUserId: 'actor',
    action: 'payment.balance_collected',
    targetType: 'booking',
    targetId: 'booking',
    ...entry,
  });
  const json = execute.mock.calls[0].find(
    (value) => typeof value === 'string' && value.startsWith('{') && value.includes('"_audit"'),
  );
  return JSON.parse(json as string);
}
describe('audit evidence at write time', () => {
  it('records a known financial outcome/source and strips secrets before storage', async () => {
    const details = await capture({
      operationId: 'collection:123',
      details: {
        amount: { amount: '250.00', currency: 'EUR' },
        before: { apiKey: 'private-secret', price: '1000.00' },
        token: 'private-token',
      },
    });
    expect(details).toMatchObject({
      _audit: { version: 1, result: 'completed', source: 'POKPAY', operationId: 'collection:123' },
      before: { price: '1000.00' },
    });
    expect(JSON.stringify(details)).not.toContain('private-');
  });
  it('keeps pending/unknown distinct and never assumes an unregistered event succeeded', async () => {
    expect((await capture({ action: 'payment.refund_pending' }))._audit.result).toBe('pending');
    expect((await capture({ action: 'payment.refund_unknown' }))._audit.result).toBe('unknown');
    expect((await capture({ action: 'future.unverified_event' }))._audit.result).toBeUndefined();
    expect((await capture({ details: { result: 'failed' } }))._audit.result).toBe('failed');
  });
  it('reports storage failure without secrets and preserves the rejection for transaction rollback', async () => {
    const error = Error('database failure containing private-secret');
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await expect(
      new AuditLogService({} as never).recordInTransaction(
        { $executeRaw: vi.fn().mockRejectedValue(error) } as never,
        {
          tenantId: 't',
          propertyId: 'p',
          actorUserId: 'a',
          action: 'payment.refunded',
          targetType: 'booking',
          targetId: 'b',
        },
      ),
    ).rejects.toBe(error);
    expect(reportOperationalFailure).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        component: 'audit',
        operation: 'record',
        tenantId: 't',
        propertyId: 'p',
      }),
    );
    expect(vi.mocked(reportOperationalFailure).mock.calls.at(-1)?.[0]).not.toBe(error);
  });
});
