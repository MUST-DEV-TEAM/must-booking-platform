import { describe, expect, it, vi } from 'vitest';

import { ClockBookingService } from './clock-booking.service';

type Guest = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

type GuestResolver = (tx: unknown, tenantId: string, guest: Guest) => Promise<string>;

const resolveGuest = (
  ClockBookingService.prototype as unknown as { resolveGuest: GuestResolver }
).resolveGuest;

function transactionWith(...queryResults: unknown[]) {
  return {
    $queryRaw: vi.fn().mockImplementation(async () => queryResults.shift()),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

const baseGuest: Guest = {
  email: 'guest@example.test',
  firstName: 'Test',
  lastName: 'Guest',
  phone: '+355 69 123 4567',
};

describe('ClockBookingService guest matching', () => {
  it('reuses the email guest when email and phone match the same record', async () => {
    const tx = transactionWith([{ id: 'guest-1' }], [{ id: 'guest-1' }]);

    await expect(resolveGuest(tx, 'tenant-1', baseGuest)).resolves.toBe('guest-1');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps email-first attachment and flags a different exact phone candidate', async () => {
    const tx = transactionWith([{ id: 'email-guest' }], [{ id: 'phone-guest' }]);

    await expect(resolveGuest(tx, 'tenant-1', baseGuest)).resolves.toBe('email-guest');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['tenant-1', 'email-guest', 'phone-guest']),
    );
  });

  it('creates a new guest and stores the phone candidate instead of attaching to it', async () => {
    const tx = transactionWith([], [{ id: 'phone-guest' }], [{ id: 'new-guest' }]);

    await expect(
      resolveGuest(tx, 'tenant-1', { ...baseGuest, email: 'new@example.test' }),
    ).resolves.toBe('new-guest');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls[2]).toEqual(
      expect.arrayContaining(['tenant-1', 'new@example.test', 'phone-guest']),
    );
  });

  it('does not perform a phone lookup when no phone was supplied', async () => {
    const tx = transactionWith([], [{ id: 'new-guest' }]);

    await expect(resolveGuest(tx, 'tenant-1', { ...baseGuest, phone: null })).resolves.toBe(
      'new-guest',
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
