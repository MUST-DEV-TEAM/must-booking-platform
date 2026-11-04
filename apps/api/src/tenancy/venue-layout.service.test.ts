import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { VenueLayoutService } from './venue-layout.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const venueId = 'b2222222-2222-4222-8222-222222222222';
const areaId = 'd4444444-4444-4444-8444-444444444444';
const tableId = 'e5555555-5555-4555-8555-555555555555';
const otherTableId = 'f6666666-6666-4666-8666-666666666666';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';

const planOk = { diningEnabled: true, maxVenues: 3, activeVenues: 1 };

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
  return { layout: new VenueLayoutService(database as never, audit as never), queryRaw, audit };
}

describe('VenueLayoutService', () => {
  it('allows layout reads and writes despite legacy plan dining being disabled', async () => {
    const off = { ...planOk, diningEnabled: false };
    await expect(service([off], [], [], []).layout.get(tenantId, venueId)).resolves.toEqual({
      areas: [],
      combinations: [],
    });
    await expect(
      service([off], [{ id: areaId, name: 'Terrace' }]).layout.createArea(
        tenantId,
        venueId,
        actorUserId,
        { name: 'Terrace' },
      ),
    ).resolves.toMatchObject({ id: areaId, name: 'Terrace' });
  });

  it('will not delete an area that still has tables', async () => {
    const { layout } = service([planOk], [{ n: 2 }]);
    await expect(layout.deleteArea(tenantId, venueId, areaId, actorUserId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('will not combine a table with itself, and does not touch the database to say so', async () => {
    const { layout, queryRaw } = service([planOk]);
    await expect(
      layout.setCombinable(tenantId, venueId, tableId, actorUserId, { tableIds: [tableId] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('will not combine with a table that is not in this venue', async () => {
    const { layout } = service([planOk], [{ id: tableId }]);
    await expect(
      layout.setCombinable(tenantId, venueId, tableId, actorUserId, { tableIds: [otherTableId] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes nothing when one of the moved tables is unknown', async () => {
    const { layout, queryRaw } = service(
      [planOk],
      [{ id: tableId, mapWidth: 80, mapHeight: 80, areaWidth: 1000, areaHeight: 700 }],
    );
    await expect(
      layout.savePositions(tenantId, venueId, actorUserId, {
        positions: [
          { tableId, mapX: 5, mapY: 5 },
          { tableId: otherTableId, mapX: 9, mapY: 9 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Only the plan check and the table lookup ran: no UPDATE was issued.
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when a moved table would leave its area', async () => {
    const { layout, queryRaw } = service(
      [planOk],
      [{ id: tableId, mapWidth: 80, mapHeight: 80, areaWidth: 1000, areaHeight: 700 }],
    );
    await expect(
      layout.savePositions(tenantId, venueId, actorUserId, {
        positions: [{ tableId, mapX: 990, mapY: 5 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

it('refuses to stack a new table on a full map', async () => {
  const { layout, queryRaw } = service(
    [planOk],
    [{ mapWidth: 100, mapHeight: 100 }],
    [{ x: 0, y: 0, w: 100, h: 100 }],
  );
  await expect(
    layout.createTable(tenantId, venueId, areaId, actorUserId, {
      label: 'T',
      minSeats: 1,
      maxSeats: 2,
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(queryRaw).toHaveBeenCalledTimes(3);
});
it('validates every resize before writing any of the positions', async () => {
  const { layout, queryRaw } = service(
    [planOk],
    [
      {
        id: tableId,
        shape: 'square',
        mapWidth: 80,
        mapHeight: 80,
        areaWidth: 1000,
        areaHeight: 700,
      },
    ],
  );
  await expect(
    layout.savePositions(tenantId, venueId, actorUserId, {
      positions: [{ tableId, mapX: 0, mapY: 0, mapWidth: 120, mapHeight: 80 }],
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(queryRaw).toHaveBeenCalledTimes(2);
});
