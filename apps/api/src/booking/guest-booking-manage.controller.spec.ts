import { describe, it, expect, vi } from 'vitest';
import { GuestBookingManageController } from './guest-booking-manage.controller';
import { CancellationLinkService } from './cancellation-link.service';
const scope = { tenantId: 'tenant', propertyId: 'property' };
function fixture(overrides: Record<string, unknown> = {}) {
  const row = {
    id: 'booking',
    reference: 'MUST-100',
    status: 'CONFIRMED',
    version: 2,
    startsOn: '2030-07-10',
    endsOn: '2030-07-12',
    room: 'Double',
    currency: 'EUR',
    paid: '100.10',
    refunded: '0.11',
    external: null,
    orderReference: null,
    onlineRefundable: true,
    terms: {
      arrivalDate: '2030-07-10',
      timezone: 'Europe/Tirane',
      cutoffAt: new Date(Date.now() + 86400000).toISOString(),
      autoRefund: true,
      freeCancellationUntilHours: 504,
    },
    ...overrides,
  };
  const db = {
    withTenantTransaction: vi.fn(async (_scope, fn) =>
      fn({ $queryRaw: vi.fn().mockResolvedValue([row]) }),
    ),
  };
  const links = new CancellationLinkService(),
    token = links.create({ ...scope, bookingId: 'booking', guestSessionId: 'session' });
  const provider = {
    cancelBooking: vi.fn().mockResolvedValue({ ok: true, value: { id: 'booking' } }),
  };
  const requests = {
    guestRequest: vi.fn().mockResolvedValue({ requested: true, requestId: 'request' }),
  };
  const financial = {
    read: vi.fn().mockResolvedValue({ status: 'NOT_CONNECTED', data: null }),
    refresh: vi.fn().mockRejectedValue(new Error('Uncertain')),
  };
  const controller = new GuestBookingManageController(
    db as never,
    links,
    provider as never,
    requests as never,
    financial as never,
  );
  return { controller, provider, requests, financial, db, token, row };
}
describe('signed guest booking management', () => {
  it('shows exact refund and saved terms on GET without cancelling or moving money', async () => {
    const f = fixture();
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({
      automaticAllowed: true,
      refundAmount: '99.99',
      policyKnown: true,
    });
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
    expect(f.requests.guestRequest).not.toHaveBeenCalled();
  });
  it('checks the deadline when clicked and sends a staff request without cancelling', async () => {
    const f = fixture({
      terms: {
        arrivalDate: '2030-07-10',
        cutoffAt: new Date(Date.now() - 1000).toISOString(),
        autoRefund: true,
      },
    });
    expect(
      await f.controller.confirm(
        { tenantContext: scope },
        'booking',
        {
          token: f.token,
          action: 'cancel',
          version: 2,
          details: 'Travel changed',
          requestRefund: true,
        },
        'same-key',
      ),
    ).toMatchObject({ requested: true });
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
    expect(f.requests.guestRequest).toHaveBeenCalledOnce();
  });
  it.each([{ terms: null }, { onlineRefundable: false }, { orderReference: 'group' }])(
    'requires review for unknown terms, offline money and shared orders (%o)',
    async (overrides) => {
      const f = fixture(overrides);
      await f.controller.confirm(
        { tenantContext: scope },
        'booking',
        { token: f.token, action: 'cancel', version: 2, details: 'Please review' },
        'key',
      );
      expect(f.provider.cancelBooking).not.toHaveBeenCalled();
      expect(f.requests.guestRequest).toHaveBeenCalledOnce();
    },
  );
  it('uses the existing cancellation command with the signed guest identity and request key', async () => {
    const f = fixture();
    await f.controller.confirm(
      { tenantContext: scope },
      'booking',
      { token: f.token, action: 'cancel', version: 2, details: 'Travel changed' },
      'same-key',
    );
    expect(f.provider.cancelBooking).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        guestSessionId: 'session',
        idempotencyKey: 'guest-manage:same-key',
        expectedVersion: 2,
      }),
    );
  });
  it('refuses mismatched tokens and stale versions before side effects', async () => {
    const f = fixture();
    await expect(
      f.controller.preview(
        { tenantContext: { ...scope, propertyId: 'other' } },
        'booking',
        f.token,
      ),
    ).rejects.toThrow();
    expect(f.db.withTenantTransaction).not.toHaveBeenCalled();
    await expect(
      f.controller.confirm(
        { tenantContext: scope },
        'booking',
        { token: f.token, action: 'cancel', version: 1, details: 'Travel changed' },
        'key',
      ),
    ).rejects.toThrow('changed');
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
  });
  it('sends uncertain Clock finances for staff review, preserving the active booking', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'READY', data: null });
    const result = await f.controller.confirm(
      { tenantContext: scope },
      'booking',
      { token: f.token, action: 'cancel', version: 2, details: 'Travel changed' },
      'key',
    );
    expect(result).toMatchObject({ requested: true });
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
  });
  it('never turns an explicit staff-review request into automatic cancellation', async () => {
    const f = fixture();
    await f.controller.confirm(
      { tenantContext: scope },
      'booking',
      {
        token: f.token,
        action: 'request',
        version: 2,
        details: 'Please review',
        requestRefund: true,
      },
      'key',
    );
    expect(f.requests.guestRequest).toHaveBeenCalledOnce();
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
  });
});
