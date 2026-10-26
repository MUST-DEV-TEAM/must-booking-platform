import { describe, expect, it, vi } from 'vitest';

import { AccommodationImportService } from './accommodation-import.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';
const roomTypeId = 'd4444444-4444-4444-8444-444444444444';
const categoryId = 'e5555555-5555-4555-8555-555555555555';
const roomId = 'f6666666-6666-4666-8666-666666666666';

function harness() {
  const types = [
    { id: roomTypeId, name: 'Double', rules: 'Stored type rules.', status: 'PUBLISHED' as const },
  ];
  const rooms = [
    { id: roomId, name: '101', rules: 'Stored room rules.', roomTypeId, isActive: false },
  ];
  const categories = [{ id: categoryId, name: 'Suites' }];
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce(types)
    .mockResolvedValueOnce(rooms)
    .mockResolvedValueOnce(categories)
    .mockResolvedValue([]);
  const executeRaw = vi.fn().mockResolvedValue(1);
  const database = {
    withTenantTransaction: vi.fn(
      async (context: unknown, callback: (tx: unknown) => Promise<unknown>) => {
        expect(context).toEqual({ tenantId, propertyId });
        return callback({ $queryRaw: queryRaw, $executeRaw: executeRaw });
      },
    ),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return {
    imports: new AccommodationImportService(database as never, audit as never),
    queryRaw,
    executeRaw,
    database,
    audit,
  };
}

describe('AccommodationImportService', () => {
  it('imports multiline room type house rules', async () => {
    const { imports, executeRaw } = harness();
    await imports.confirm(tenantId, propertyId, actorUserId, {
      kind: 'room-types',
      rows: [{ name: 'Suite', maxOccupancy: '2', rules: 'No smoking.\nQuiet after 10pm.' }],
    });
    expect(executeRaw.mock.calls[0]).toContain('No smoking.\nQuiet after 10pm.');
  });

  it('keeps stored rules when the CSV has no rules column, and clears them when the cell is blank', async () => {
    const kept = harness();
    await kept.imports.confirm(tenantId, propertyId, actorUserId, {
      kind: 'room-types',
      rows: [{ id: roomTypeId, name: 'Double', maxOccupancy: '2' }],
    });
    expect(kept.executeRaw.mock.calls[0]).toContain('Stored type rules.');
    const cleared = harness();
    await cleared.imports.confirm(tenantId, propertyId, actorUserId, {
      kind: 'room-types',
      rows: [{ id: roomTypeId, name: 'Double', maxOccupancy: '2', rules: '' }],
    });
    expect(cleared.executeRaw.mock.calls[0]).not.toContain('Stored type rules.');
  });

  it('previews creates and updates, validating category references in the same property', async () => {
    const { imports } = harness();
    const preview = await imports.preview(tenantId, propertyId, {
      kind: 'room-types',
      rows: [
        {
          id: roomTypeId,
          name: 'Double updated',
          maxOccupancy: '3',
          status: 'HIDDEN',
          categoryId,
        },
        { name: 'Suite', maxOccupancy: '2', status: 'DRAFT' },
      ],
    });

    expect(preview).toMatchObject({
      summary: { create: 1, update: 1, errors: 0 },
      canConfirm: true,
      rows: [
        { rowNumber: 2, action: 'update', target: 'Double updated', errors: [] },
        { rowNumber: 3, action: 'create', target: 'Suite', errors: [] },
      ],
    });
  });

  it('reports row errors and refuses to apply an invalid batch', async () => {
    const { imports, executeRaw, audit } = harness();
    const body = {
      kind: 'room-types',
      rows: [{ name: 'Suite', maxOccupancy: '0', categoryId: roomTypeId }],
    };
    await expect(imports.preview(tenantId, propertyId, body)).resolves.toMatchObject({
      canConfirm: false,
      summary: { create: 0, update: 0, errors: 1 },
      rows: [
        {
          action: 'invalid',
          errors: expect.arrayContaining([
            'Maximum occupancy must be a positive integer.',
            'Category ID was not found in this property.',
          ]),
        },
      ],
    });
    await expect(imports.confirm(tenantId, propertyId, actorUserId, body)).rejects.toThrow(
      'Fix the CSV rows with errors before importing.',
    );
    expect(executeRaw).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('applies a valid room import atomically and records one accommodation import audit row', async () => {
    const { imports, executeRaw, audit, database } = harness();
    const summary = await imports.confirm(tenantId, propertyId, actorUserId, {
      kind: 'rooms',
      rows: [
        {
          id: roomId,
          roomTypeId,
          roomTypeName: 'Double',
          name: '101',
          isActive: 'true',
        },
        { roomTypeName: 'Double', name: '102', isActive: 'false', floor: '2' },
      ],
    });

    expect(summary).toEqual({ create: 1, update: 1, errors: 0 });
    expect(database.withTenantTransaction).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId,
        propertyId,
        actorUserId,
        action: 'accommodation.imported',
        details: { kind: 'rooms', create: 1, update: 1, errors: 0 },
      }),
    );
  });

  it('keeps an existing inactive state when an imported room cell is blank', async () => {
    const { imports } = harness();
    await expect(
      imports.preview(tenantId, propertyId, {
        kind: 'rooms',
        rows: [{ id: roomId, roomTypeId, roomTypeName: 'Double', name: '101', isActive: '' }],
      }),
    ).resolves.toMatchObject({ canConfirm: true, rows: [{ action: 'update', errors: [] }] });
  });
});
