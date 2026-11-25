import { describe, it, expect, vi } from 'vitest';
import { GuestBookingManageController } from './guest-booking-manage.controller';
import { CancellationLinkService } from './cancellation-link.service';
import { ConflictException } from '@nestjs/common';
const scope = { tenantId: 'tenant', propertyId: 'property' };
const financialSnapshot = (overrides: Record<string, unknown> = {}) => ({
  fetchedAt: new Date().toISOString(),
  bookingVersion: 2,
  balance: { amount: '100.10', currency: 'EUR' },
  paid: { amount: '100.10', currency: 'EUR' },
  refunded: { amount: '0.11', currency: 'EUR' },
  ...overrides,
});
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
      fn({ $queryRaw: vi.fn().mockResolvedValue([{ ...row }]) }),
    ),
  };
  const links = new CancellationLinkService(),
    token = links.create({ ...scope, bookingId: 'booking', guestSessionId: 'session' });
  const provider = {
    cancelBooking: vi.fn().mockResolvedValue({ ok: true, value: { id: 'booking' } }),
  };
  const requests = {
    guestRequest: vi.fn().mockResolvedValue({ requested: true, requestId: 'request' }),
    // No payment fee is kept back unless a test sets one.
    guestRefundFee: vi.fn().mockResolvedValue(null),
  };
  const financial = {
    read: vi.fn().mockResolvedValue({ status: 'NOT_CONNECTED', data: null }),
    refresh: vi.fn().mockRejectedValue(new Error('Uncertain')),
  };
  const confirmations = {
    emailHint: vi.fn().mockResolvedValue('a***@example.test'),
    resendToGuest: vi.fn().mockResolvedValue({ ok: true, sentTo: 'a***@example.test' }),
  };
  const controller = new GuestBookingManageController(
    db as never,
    links,
    provider as never,
    requests as never,
    financial as never,
    confirmations as never,
  );
  return { controller, provider, requests, financial, confirmations, db, token, row };
}
describe('signed guest booking management', () => {
  it('shows where the confirmation went, masked, and sends it again on request (G-96)', async () => {
    const f = fixture();
    const preview = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(preview.emailHint).toBe('a***@example.test');
    const sent = await f.controller.resendConfirmation({ tenantContext: scope }, 'booking', {
      token: f.token,
      email: 'other@example.test',
    });
    expect(sent).toEqual({ sent: true, sentTo: 'a***@example.test' });
    expect(f.confirmations.resendToGuest).toHaveBeenCalledWith(
      scope,
      'booking',
      'other@example.test',
    );
    await expect(
      f.controller.resendConfirmation({ tenantContext: scope }, 'booking', {
        token: f.token,
        email: 'not an address',
      }),
    ).rejects.toThrow('valid email');
    f.confirmations.resendToGuest.mockResolvedValue({
      ok: false,
      code: 'RESEND_LIMIT',
      message: 'Too many today.',
    });
    await expect(
      f.controller.resendConfirmation({ tenantContext: scope }, 'booking', { token: f.token }),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('shows the refund after the payment fee the hotel keeps back, and the fee itself', async () => {
    const f = fixture();
    f.requests.guestRefundFee.mockResolvedValue({ amount: '12.85', currency: 'EUR' });
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({ refundAmount: '87.14', providerFee: '12.85' });
  });

  it('shows exact refund and saved terms on GET without cancelling or moving money', async () => {
    const f = fixture();
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({
      automaticAllowed: true,
      refundAmount: '99.99',
      providerFee: null,
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
  it('refreshes an older booking payment check before offering automatic cancellation', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'SYNCED', data: null });
    f.financial.refresh
      .mockResolvedValueOnce(financialSnapshot({ bookingVersion: 1 }))
      .mockResolvedValueOnce(financialSnapshot());
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({ automaticAllowed: true, refundAmount: '99.99' });
    expect(f.financial.refresh).toHaveBeenCalledTimes(2);
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
    expect(f.requests.guestRequest).not.toHaveBeenCalled();
  });
  it('reloads the preview booking when it changes during the financial check', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'SYNCED', data: null });
    f.financial.refresh.mockImplementation(async () => {
      f.row.version = 3;
      return financialSnapshot({ bookingVersion: 3 });
    });
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({ version: 3, automaticAllowed: true, refundAmount: '99.99' });
    expect(f.db.withTenantTransaction).toHaveBeenCalledTimes(2);
    expect(f.requests.guestRequest).not.toHaveBeenCalled();
  });
  it('keeps polling a recent snapshot for an older version instead of offering review', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({
      status: 'SYNCED',
      data: financialSnapshot({ bookingVersion: 1 }),
    });
    f.financial.refresh.mockResolvedValue(financialSnapshot({ bookingVersion: 1 }));
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({ automaticAllowed: false, checkingMoney: true });
    expect(f.financial.refresh).toHaveBeenCalledTimes(4);
    expect(f.requests.guestRequest).not.toHaveBeenCalled();
  });
  it('refreshes an expired financial snapshot before allowing cancellation', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'SYNCED', data: null });
    f.financial.refresh
      .mockResolvedValueOnce(
        financialSnapshot({ fetchedAt: new Date(Date.now() - 61000).toISOString() }),
      )
      .mockResolvedValueOnce(financialSnapshot());
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({ automaticAllowed: true, refundAmount: '99.99' });
    expect(f.financial.refresh).toHaveBeenCalledTimes(2);
  });
  it('rechecks the saved terms when reloading a changed preview', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'SYNCED', data: null });
    f.financial.refresh.mockImplementation(async () => {
      f.row.version = 3;
      f.row.startsOn = '2030-07-11';
      return financialSnapshot({ bookingVersion: 3 });
    });
    const result = await f.controller.preview({ tenantContext: scope }, 'booking', f.token);
    expect(result).toMatchObject({ version: 3, automaticAllowed: false, policyKnown: false });
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
  });
  it('retries a concurrent financial read conflict before cancelling exactly once', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'SYNCED', data: null });
    f.financial.refresh
      .mockRejectedValueOnce(new ConflictException('Booking changed during the financial check.'))
      .mockResolvedValueOnce(financialSnapshot());
    const result = await f.controller.confirm(
      { tenantContext: scope },
      'booking',
      { token: f.token, action: 'cancel', version: 2, details: 'Travel changed' },
      'same-key',
    );
    expect(result).toMatchObject({ cancelled: true });
    expect(f.provider.cancelBooking).toHaveBeenCalledOnce();
    expect(f.requests.guestRequest).not.toHaveBeenCalled();
  });
  it('requires renewed confirmation when booking versions still differ after refreshing', async () => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'SYNCED', data: null });
    f.financial.refresh.mockResolvedValue(financialSnapshot({ bookingVersion: 3 }));
    await expect(
      f.controller.confirm(
        { tenantContext: scope },
        'booking',
        { token: f.token, action: 'cancel', version: 2, details: 'Travel changed' },
        'same-key',
      ),
    ).rejects.toThrow('Reload its details');
    expect(f.financial.refresh).toHaveBeenCalledTimes(2);
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
    expect(f.requests.guestRequest).not.toHaveBeenCalled();
  });
  it.each([
    { paid: { amount: '90.00', currency: 'EUR' } },
    { refunded: { amount: '5.00', currency: 'EUR' } },
    { balance: { amount: '100.10', currency: 'ALL' } },
    { balance: { amount: '-1.00', currency: 'EUR' } },
  ])('still requires staff review for a genuine financial mismatch (%o)', async (overrides) => {
    const f = fixture({ external: '123' });
    f.financial.read.mockResolvedValue({ status: 'SYNCED', data: null });
    f.financial.refresh.mockResolvedValue(financialSnapshot(overrides));
    await f.controller.confirm(
      { tenantContext: scope },
      'booking',
      { token: f.token, action: 'cancel', version: 2, details: 'Travel changed' },
      'same-key',
    );
    expect(f.provider.cancelBooking).not.toHaveBeenCalled();
    expect(f.requests.guestRequest).toHaveBeenCalledOnce();
    expect(f.financial.refresh).toHaveBeenCalledOnce();
  });
});
