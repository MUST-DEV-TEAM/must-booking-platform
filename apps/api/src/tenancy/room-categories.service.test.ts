import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { RoomCategoriesService } from './room-categories.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';
const categoryId = 'd4444444-4444-4444-8444-444444444444';

function setup(queryResults: unknown[][] = []) {
  const queryRaw = vi.fn();
  for (const result of queryResults) queryRaw.mockResolvedValueOnce(result);
  queryRaw.mockResolvedValue([]);
  const executeRaw = vi.fn().mockResolvedValue(1);
  const database = {
    withTenantTransaction: async (
      context: unknown,
      callback: (tx: {
        $queryRaw: typeof queryRaw;
        $executeRaw: typeof executeRaw;
      }) => Promise<unknown>,
    ) => {
      expect(context).toEqual({ tenantId, propertyId });
      return callback({ $queryRaw: queryRaw, $executeRaw: executeRaw });
    },
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new RoomCategoriesService(database as never, audit as never),
    queryRaw,
    executeRaw,
    audit,
  };
}

describe('RoomCategoriesService', () => {
  it('lists categories with property-scoped room type counts', async () => {
    const category = { id: categoryId, name: 'Suites', roomCount: 3 };
    const { service } = setup([[category]]);

    await expect(service.list(tenantId, propertyId)).resolves.toEqual([category]);
  });

  it('creates a category at the end of the current order and records the actor', async () => {
    const created = {
      id: categoryId,
      name: 'Suites',
      description: null,
      sortOrder: 2,
      storefrontVisible: true,
      roomCount: 0,
    };
    const { service, audit } = setup([[{ id: propertyId }], [], [{ nextOrder: 2 }], [created]]);

    await expect(
      service.create(tenantId, propertyId, actorUserId, { name: ' Suites ' }),
    ).resolves.toEqual(created);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_category.created',
        targetId: expect.any(String),
      }),
    );
  });

  it('updates storefront visibility and permits clearing the description', async () => {
    const updated = {
      id: categoryId,
      name: 'Suites',
      description: null,
      sortOrder: 0,
      storefrontVisible: false,
      roomCount: 2,
    };
    const { service, queryRaw } = setup([[updated]]);

    await expect(
      service.update(tenantId, propertyId, categoryId, actorUserId, {
        description: '',
        storefrontVisible: false,
      }),
    ).resolves.toEqual(updated);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]).toContain(false);
  });

  it('requires a complete, unique property ordering', async () => {
    const { service } = setup([[{ id: categoryId }]]);

    await expect(
      service.reorder(tenantId, propertyId, actorUserId, { categoryIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unassigns room types before deleting the category in the same transaction', async () => {
    const { service, queryRaw, executeRaw, audit } = setup([[{ id: categoryId }]]);

    await expect(
      service.remove(tenantId, propertyId, categoryId, actorUserId),
    ).resolves.toBeUndefined();
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'room_category.deleted', targetId: categoryId }),
    );
  });

  it('returns not found when deleting a category outside the property', async () => {
    const { service, executeRaw } = setup([[]]);

    await expect(
      service.remove(tenantId, propertyId, categoryId, actorUserId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
  it('rejects case-insensitive duplicate names before insertion', async () => {
    const { service, executeRaw } = setup([[{ id: propertyId }], [{ id: categoryId }]]);
    await expect(
      service.create(tenantId, propertyId, actorUserId, { name: 'suites' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(executeRaw).not.toHaveBeenCalled();
  });
  it('rejects duplicate renames and does not update or audit', async () => {
    const { service, audit } = setup([[{ id: propertyId }], [{ id: 'other' }]]);
    await expect(
      service.update(tenantId, propertyId, categoryId, actorUserId, { name: 'SUITES' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });
  it('does not create categories in a missing or foreign property', async () => {
    const { service, queryRaw } = setup([[]]);
    await expect(
      service.create(tenantId, propertyId, actorUserId, { name: 'Suites' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
  it.each([
    { name: '' },
    { name: 'x'.repeat(201) },
    { name: 'Suites', description: 'x'.repeat(2001) },
  ])('rejects invalid category fields', async (input) => {
    const { service, queryRaw } = setup();
    await expect(service.create(tenantId, propertyId, actorUserId, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it('writes contiguous positions in the supplied complete order', async () => {
    const second = 'e5555555-5555-4555-8555-555555555555';
    const { service, executeRaw } = setup([[{ id: categoryId }, { id: second }]]);
    await service.reorder(tenantId, propertyId, actorUserId, { categoryIds: [second, categoryId] });
    expect(executeRaw.mock.calls[0]).toContain(0);
    expect(executeRaw.mock.calls[0]).toContain(second);
    expect(executeRaw.mock.calls[1]).toContain(1);
    expect(executeRaw.mock.calls[1]).toContain(categoryId);
  });
});
