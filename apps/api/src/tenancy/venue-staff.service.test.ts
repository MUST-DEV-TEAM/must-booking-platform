import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { VenueStaffService } from './venue-staff.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const venueId = 'b2222222-2222-4222-8222-222222222222';
const targetUserId = 'e5555555-5555-4555-8555-555555555555';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';

const planOk = { diningEnabled: true, maxVenues: 3, activeVenues: 1 };
const assignment = {
  userId: targetUserId,
  email: 'host@example.test',
  firstName: 'Ana',
  lastName: 'Host',
  role: 'HOST',
  suspendedAt: null,
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
  const invites = { createVenueDirect: vi.fn().mockResolvedValue({ userId: targetUserId }) };
  return {
    staff: new VenueStaffService(database as never, audit as never, invites as never),
    queryRaw,
    audit,
    invites,
  };
}

describe('VenueStaffService.createAccount', () => {
  const body = {
    firstName: ' Ana ',
    lastName: 'Host',
    email: ' Ana@Example.test ',
    password: 'correct-horse-battery-1',
    role: 'HOST',
  };

  it('refuses when the plan does not include dining', async () => {
    const { staff } = service([{ ...planOk, diningEnabled: false }]);
    await expect(staff.createAccount(tenantId, venueId, body, actorUserId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    ['a missing first name', { ...body, firstName: ' ' }],
    ['a bad email', { ...body, email: 'not-an-email' }],
    ['a short password', { ...body, password: 'short1' }],
    ['a password with no digit', { ...body, password: 'correct-horse-battery' }],
    ['an unknown role', { ...body, role: 'CHEF' }],
  ])('rejects %s before touching the database', async (_label, input) => {
    const { staff, queryRaw, invites } = service([planOk]);
    await expect(staff.createAccount(tenantId, venueId, input, actorUserId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(queryRaw).not.toHaveBeenCalled();
    expect(invites.createVenueDirect).not.toHaveBeenCalled();
  });

  it('creates the account with tidy values and returns the person with their role', async () => {
    const { staff, invites } = service([planOk], [assignment]);
    await expect(staff.createAccount(tenantId, venueId, body, actorUserId)).resolves.toEqual(
      assignment,
    );
    expect(invites.createVenueDirect).toHaveBeenCalledWith({
      tenantId,
      venueId,
      actorUserId,
      firstName: 'Ana',
      lastName: 'Host',
      email: 'ana@example.test',
      password: 'correct-horse-battery-1',
      role: 'HOST',
    });
  });
});

describe('VenueStaffService.assign', () => {
  it('refuses when the plan does not include dining', async () => {
    const { staff } = service([{ ...planOk, diningEnabled: false }]);
    await expect(
      staff.assign(tenantId, venueId, targetUserId, { role: 'HOST' }, actorUserId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([[{ role: 'OWNER' }], [{ role: 'host' }], [{}], ['HOST'], [null]])(
    'rejects the role body %j before touching the database',
    async (body) => {
      const { staff, queryRaw } = service([planOk]);
      await expect(
        staff.assign(tenantId, venueId, targetUserId, body, actorUserId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(queryRaw).not.toHaveBeenCalled();
    },
  );

  it('refuses a person who is not a member of the workspace', async () => {
    const { staff } = service([planOk], []);
    const error = await staff
      .assign(tenantId, venueId, targetUserId, { role: 'HOST' }, actorUserId)
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('That person is not a member of this workspace.');
  });

  it('assigns a member and records who did it', async () => {
    const { staff, audit } = service([planOk], [{ userId: targetUserId }], [assignment]);
    await expect(
      staff.assign(tenantId, venueId, targetUserId, { role: 'HOST' }, actorUserId),
    ).resolves.toEqual(assignment);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId,
        actorUserId,
        action: 'venue.staff_assigned',
        targetType: 'venue',
        targetId: venueId,
        details: { userId: targetUserId, role: 'HOST' },
      }),
    );
  });
});

describe('VenueStaffService.setSuspended', () => {
  it('reports an unknown assignment as not found', async () => {
    const { staff } = service([planOk], []);
    await expect(
      staff.setSuspended(tenantId, venueId, targetUserId, true, actorUserId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('suspends an assignment and records it', async () => {
    const { staff, audit } = service([planOk], [{ ...assignment, suspendedAt: new Date() }]);
    await staff.setSuspended(tenantId, venueId, targetUserId, true, actorUserId);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'venue.staff_suspended' }),
    );
  });

  it('resumes an assignment and records it', async () => {
    const { staff, audit } = service([planOk], [assignment]);
    await staff.setSuspended(tenantId, venueId, targetUserId, false, actorUserId);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'venue.staff_resumed' }),
    );
  });
});
