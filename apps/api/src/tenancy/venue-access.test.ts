import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CapabilitiesService } from './capabilities.service';
import { PUBLIC_ROUTE, PUBLIC_TENANT_SCOPE, TENANT_SCOPE } from './tenant-context.decorator';
import { REQUIRED_ROLES, Role } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { VENUE_CAPABILITY_CATALOG, VENUE_ROLE_CAPABILITIES } from './venue-capability-catalog';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const venueId = 'b2222222-2222-4222-8222-222222222222';
const userId = 'c3333333-3333-4333-8333-333333333333';

/** A database double whose transaction client answers `$queryRaw` calls in order. */
function databaseAnswering(...answers: unknown[][]) {
  const queryRaw = vi.fn();
  for (const answer of answers) queryRaw.mockResolvedValueOnce(answer);
  queryRaw.mockResolvedValue([]);
  const contexts: unknown[] = [];
  const database = {
    withTenantTransaction: async (
      context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => {
      contexts.push(context);
      return callback({ $queryRaw: queryRaw });
    },
  };
  return { database, queryRaw, contexts };
}

describe('venue capability catalog', () => {
  const allKeys = VENUE_CAPABILITY_CATALOG.map((entry) => entry.key);

  it('defines the stage 1 keys', () => {
    expect(allKeys).toEqual(
      expect.arrayContaining([
        'venue.view',
        'venue.manage',
        'venue.staff',
        'reservations.view',
        'reservations.manage',
      ]),
    );
  });

  it('gives a manager every capability and a host only the front-of-house ones', () => {
    expect([...VENUE_ROLE_CAPABILITIES.MANAGER].sort()).toEqual([...allKeys].sort());
    expect(VENUE_ROLE_CAPABILITIES.HOST).toEqual([
      'venue.view',
      'reservations.view',
      'reservations.manage',
    ]);
  });
});

describe('CapabilitiesService.effectiveForVenue', () => {
  const allKeys = VENUE_CAPABILITY_CATALOG.map((entry) => entry.key);
  const run = (...answers: unknown[][]) => {
    const { database } = databaseAnswering(...answers);
    return new CapabilitiesService(database as never).effectiveForVenue({
      tenantId,
      venueId,
      userId,
    });
  };

  it('gives a workspace owner every venue capability', async () => {
    expect(await run([{ role: 'OWNER' }])).toEqual(allKeys);
  });

  it('gives a workspace admin every venue capability', async () => {
    expect(await run([{ role: 'ADMIN' }])).toEqual(allKeys);
  });

  it('gives an assigned host the host capabilities', async () => {
    expect(await run([{ role: 'STAFF' }], [{ role: 'HOST' }])).toEqual(
      VENUE_ROLE_CAPABILITIES.HOST,
    );
  });

  it('gives nothing to a suspended assignment (the query excludes suspended rows)', async () => {
    expect(await run([{ role: 'STAFF' }], [])).toEqual([]);
  });

  it('gives nothing to a workspace member with no assignment to this venue', async () => {
    expect(await run([{ role: 'STAFF' }])).toEqual([]);
  });
});

describe('RolesGuard with a venue scope', () => {
  const guardFor = (assignmentRows: unknown[]) => {
    const { database } = databaseAnswering([{ role: 'STAFF' }], assignmentRows);
    const reflector = { getAllAndOverride: () => [Role.VenueStaff] };
    const audit = { record: vi.fn(), recordInTransaction: vi.fn() };
    const request = { headers: {}, tenantContext: { userId, tenantId, venueId } };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    const guard = new RolesGuard(
      reflector as never,
      {} as never,
      database as never,
      audit as never,
    );
    return { guard, context };
  };

  it('lets a person with an active assignment act as venue staff', async () => {
    const { guard, context } = guardFor([{ assigned: 1 }]);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it('refuses a person whose assignment is missing or suspended', async () => {
    const { guard, context } = guardFor([]);
    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TenantContextGuard with a venue scope', () => {
  const guardFor = (venueRows: unknown[]) => {
    const { database, contexts } = databaseAnswering([{ allowed: 1 }], venueRows, [
      { state: 'ACTIVE' },
    ]);
    const reflector = {
      get: () => undefined,
      getAllAndOverride: (key: string) => {
        if (key === TENANT_SCOPE) return { venueParam: 'venueId' };
        if (key === PUBLIC_ROUTE || key === PUBLIC_TENANT_SCOPE || key === REQUIRED_ROLES)
          return undefined;
        return undefined;
      },
    };
    const auth = { getSessionUserId: async () => userId };
    const request: {
      method: string;
      headers: Record<string, string>;
      params: Record<string, string>;
      tenantContext?: unknown;
    } = {
      method: 'GET',
      headers: { cookie: 'must_session=abc' },
      params: { tenantId, venueId },
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    const guard = new TenantContextGuard(
      reflector as never,
      auth as never,
      database as never,
      {} as never,
    );
    return { guard, context, request, contexts };
  };

  it('puts the venue id on the request context when the venue exists in the tenant', async () => {
    const { guard, context, request } = guardFor([{ allowed: 1 }]);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.tenantContext).toEqual({ userId, tenantId, propertyId: undefined, venueId });
  });

  it('refuses a venue id that does not exist in the tenant', async () => {
    const { guard, context } = guardFor([]);
    await expect(guard.canActivate(context as never)).rejects.toThrow(
      'The requested tenant or property is outside this session scope.',
    );
  });
});
