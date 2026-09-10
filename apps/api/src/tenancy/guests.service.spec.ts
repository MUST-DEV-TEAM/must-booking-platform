import { describe, expect, it, vi } from 'vitest';

import { GuestsService } from './guests.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const propertyId = '00000000-0000-4000-8000-000000000002';
const flaggedGuestId = '00000000-0000-4000-8000-000000000003';
const canonicalGuestId = '00000000-0000-4000-8000-000000000004';

function serviceWithLockedGuests() {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([
      {
        id: canonicalGuestId,
        email: 'canonical@example.test',
        firstName: 'Canonical',
        lastName: null,
        phone: null,
        suspectedDuplicateOfGuestId: null,
        mergedIntoGuestId: null,
        bookingCount: 0,
      },
      {
        id: flaggedGuestId,
        email: 'flagged@example.test',
        firstName: null,
        lastName: 'Guest',
        phone: '+355 69 123 4567',
        suspectedDuplicateOfGuestId: canonicalGuestId,
        mergedIntoGuestId: null,
        bookingCount: 0,
      },
    ]),
    $executeRaw: vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1),
  };
  const database = {
    withTenantTransaction: vi.fn(async (_context, operation) => operation(transaction)),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new GuestsService(database as never, audit as never),
    transaction,
    database,
    audit,
  };
}

describe('GuestsService duplicate review', () => {
  it('moves bookings, backfills the canonical profile, and tombstones the losing profile in one transaction', async () => {
    const { service, transaction, database, audit } = serviceWithLockedGuests();

    await expect(
      service.mergeSuspectedDuplicate(
        tenantId,
        propertyId,
        flaggedGuestId,
        canonicalGuestId,
        '00000000-0000-4000-8000-000000000005',
      ),
    ).resolves.toEqual({ canonicalGuestId, mergedGuestId: flaggedGuestId });

    expect(database.withTenantTransaction).toHaveBeenCalledWith({ tenantId }, expect.any(Function));
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(4);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        action: 'guest.merged',
        targetId: canonicalGuestId,
        details: { mergedGuestId: flaggedGuestId, movedBookingCount: 2 },
      }),
    );
  });

  it('dismisses only the flag and records no merge operation', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: flaggedGuestId, duplicateId: canonicalGuestId }]),
    };
    const database = {
      withTenantTransaction: vi.fn(async (_context, operation) => operation(transaction)),
    };
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const service = new GuestsService(database as never, audit as never);

    await expect(
      service.dismissSuspectedDuplicate(
        tenantId,
        propertyId,
        flaggedGuestId,
        '00000000-0000-4000-8000-000000000005',
      ),
    ).resolves.toBeUndefined();

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ action: 'guest.duplicate_dismissed', targetId: flaggedGuestId }),
    );
  });
});
