import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditMutationInterceptor } from './audit-mutation.interceptor';
import { auditDenial } from './audit-denial';
const context = (method = 'PATCH') =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        tenantContext: { tenantId: 't', propertyId: 'p', userId: 'u' },
        headers: { 'idempotency-key': 'attempt' },
        route: { path: '/bookings/:id/amend' },
      }),
    }),
  }) as never;
describe('failed mutation evidence', () => {
  it('preserves the original error and records a request failure without business-state claims', async () => {
    const record = vi.fn().mockResolvedValue(undefined),
      error = Error('private payload');
    const interceptor = new AuditMutationInterceptor({ record } as never);
    await expect(
      lastValueFrom(interceptor.intercept(context(), { handle: () => throwError(() => error) })),
    ).rejects.toBe(error);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'request.mutation_failed',
        result: 'failed',
        operationId: expect.stringMatching(/^request:/),
      }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('private payload');
  });
  it('records Result errors even with HTTP200 and never records ordinary page reads', async () => {
    const record = vi.fn().mockResolvedValue(undefined),
      service = new AuditMutationInterceptor({ record } as never),
      value = { ok: false, error: { code: 'PREVIEW_CHANGED' } };
    expect(await lastValueFrom(service.intercept(context(), { handle: () => of(value) }))).toBe(
      value,
    );
    expect(record).toHaveBeenCalledOnce();
    await lastValueFrom(service.intercept(context('GET'), { handle: () => of({}) }));
    expect(record).toHaveBeenCalledOnce();
  });
  it('cannot grant access when the denial audit fails', async () => {
    const record = vi.fn().mockRejectedValue(Error('audit unavailable'));
    await expect(
      auditDenial(
        { record } as never,
        { tenantId: 't', propertyId: 'p', userId: 'u' },
        'CAPABILITY_REQUIRED',
        'payments.refund',
      ),
    ).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ result: 'denied' }));
    const error = new ForbiddenException();
    await expect(
      lastValueFrom(
        new AuditMutationInterceptor({ record } as never).intercept(context(), {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
  });
});
