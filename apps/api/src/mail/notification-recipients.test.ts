import { describe, expect, it, vi } from 'vitest';
import type { UpdateNotificationTopicCommand } from '@must/domain-contracts';
import type { TenantTransaction } from '../tenancy/tenant-database.service';
import { staffRecipients } from './notification-recipients';

const context = { tenantId: 'tenant', propertyId: 'property' };
const draft: UpdateNotificationTopicCommand = {
  guestEnabled: true,
  staffEnabled: true,
  customStaffRecipients: true,
  rules: [{ target: 'MEMBERSHIP_ROLE', membershipRole: 'OWNER' }],
};
function transaction(...results: unknown[][]) {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  return { tx: { $queryRaw: query } as unknown as TenantTransaction, query };
}
describe('production recipient resolution with unsaved drafts (mocked query results)', () => {
  it('deduplicates overlapping recipients by case-insensitive address', async () => {
    const { tx } = transaction([
      { staffUserId: 'owner', email: 'Owner@example.test' },
      { staffUserId: 'owner', email: 'owner@example.test' },
      { staffUserId: 'email:external@example.test', email: 'external@example.test' },
    ]);
    expect(await staffRecipients(tx, context, 'new_booking', draft)).toEqual([
      { staffUserId: 'owner', email: 'Owner@example.test' },
      { staffUserId: 'email:external@example.test', email: 'external@example.test' },
    ]);
  });
  it('applies personal mute to optional topics, preserving external addresses', async () => {
    const { tx } = transaction(
      [
        { staffUserId: 'owner', email: 'owner@example.test' },
        { staffUserId: 'email:external@example.test', email: 'external@example.test' },
      ],
      [{ userId: 'owner' }],
    );
    expect(await staffRecipients(tx, context, 'owner_daily_summary', draft)).toEqual([
      { staffUserId: 'email:external@example.test', email: 'external@example.test' },
    ]);
  });
  it('does not consult personal mute for urgent alerts', async () => {
    const { tx, query } = transaction([{ staffUserId: 'owner', email: 'owner@example.test' }]);
    expect(await staffRecipients(tx, context, 'owner_alerts', draft)).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('returns nobody without querying saved choices when draft staff email is off', async () => {
    const { tx, query } = transaction();
    expect(
      await staffRecipients(tx, context, 'new_booking', { ...draft, staffEnabled: false }),
    ).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
  it('retains saved-setting behavior when no draft is provided', async () => {
    const { tx, query } = transaction(
      [{ custom: false, enabled: true }],
      [{ staffUserId: 'owner', email: 'owner@example.test' }],
    );
    expect(await staffRecipients(tx, context, 'new_booking')).toEqual([
      { staffUserId: 'owner', email: 'owner@example.test' },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
