import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { slugifyVenueName } from './venue-input';
import { VenuesService } from './venues.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';
const propertyId = 'd4444444-4444-4444-8444-444444444444';

const lock = { locked: 1 };
const planOk = { diningEnabled: true, maxVenues: 3, activeVenues: 1 };
const venueRow = {
  id: 'b2222222-2222-4222-8222-222222222222',
  propertyId: null,
  name: 'Grand Restaurant',
  slug: 'grand-restaurant',
  timezone: 'Europe/Tirane',
  currency: 'ALL',
  address: null,
  phone: null,
  contactEmail: null,
  active: true,
};

/** `$queryRaw` answers in the order the service asks. */
function service(...answers: unknown[][]) {
  const queryRaw = vi.fn();
  for (const answer of answers) queryRaw.mockResolvedValueOnce(answer);
  queryRaw.mockResolvedValue([]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return {
    venues: new VenuesService(database as never, audit as never),
    queryRaw,
    audit,
  };
}

const validBody = {
  name: 'Grand Restaurant',
  timezone: 'Europe/Tirane',
  currency: 'ALL',
};

describe('slugifyVenueName', () => {
  it('lowercases, strips accents and joins words with dashes', () => {
    expect(slugifyVenueName('  Café   Të Mirë! ')).toBe('cafe-te-mire');
  });
  it('falls back to a fixed word when nothing usable is left', () => {
    expect(slugifyVenueName('!!!')).toBe('venue');
  });
});

describe('VenuesService.create', () => {
  it('creates a restaurant despite legacy plan dining being disabled', async () => {
    const { venues } = service(
      [lock],
      [{ ...planOk, diningEnabled: false, maxVenues: 0 }],
      [],
      [venueRow],
    );
    await expect(venues.create(tenantId, actorUserId, validBody)).resolves.toEqual(venueRow);
  });

  it('creates beyond the legacy plan venue limit', async () => {
    const { venues } = service(
      [lock],
      [{ ...planOk, maxVenues: 1, activeVenues: 1 }],
      [],
      [venueRow],
    );
    await expect(venues.create(tenantId, actorUserId, validBody)).resolves.toEqual(venueRow);
  });

  it('rejects a linked property that is not in the tenant', async () => {
    const { venues } = service([lock], [planOk], []);
    await expect(
      venues.create(tenantId, actorUserId, { ...validBody, propertyId }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['an empty name', { ...validBody, name: '   ' }],
    ['a name over 200 characters', { ...validBody, name: 'x'.repeat(201) }],
    ['an unknown timezone', { ...validBody, timezone: 'Mars/Olympus' }],
    ['a currency that is not three capital letters', { ...validBody, currency: 'lek' }],
    ['a bad contact email', { ...validBody, contactEmail: 'not-an-email' }],
    ['a property id that is not a UUID', { ...validBody, propertyId: 'nope' }],
  ])('rejects %s before touching the database', async (_label, body) => {
    const { venues, queryRaw } = service([planOk]);
    await expect(venues.create(tenantId, actorUserId, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('creates a venue with a slug from its name and records who did it', async () => {
    const { venues, audit } = service([lock], [planOk], [], [venueRow]);
    await expect(venues.create(tenantId, actorUserId, validBody)).resolves.toEqual(venueRow);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId,
        actorUserId,
        action: 'venue.created',
        targetType: 'venue',
        targetId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
  });

  it('adds a number to the slug when another venue already uses it', async () => {
    const { venues, queryRaw } = service(
      [lock],
      [planOk],
      [{ slug: 'grand-restaurant' }],
      [{ ...venueRow, slug: 'grand-restaurant-2' }],
    );
    await venues.create(tenantId, actorUserId, validBody);
    const insertCall = queryRaw.mock.calls[3]!;
    expect(insertCall.slice(1)).toContain('grand-restaurant-2');
  });
});

describe('VenuesService.list', () => {
  it('lists restaurants despite legacy plan dining being disabled', async () => {
    const { venues } = service(
      [{ ...planOk, diningEnabled: false }],
      [{ role: 'OWNER' }],
      [venueRow],
    );
    await expect(venues.list(tenantId, actorUserId)).resolves.toEqual([venueRow]);
  });
});
