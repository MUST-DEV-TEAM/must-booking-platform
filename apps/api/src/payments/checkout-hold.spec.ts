import { describe, expect, it, vi } from 'vitest';
import { checkoutHoldMinutes } from './checkout-hold';

const scope = { tenantId: 't', propertyId: 'p' };

describe('checkoutHoldMinutes', () => {
  it('gives the minutes left on the room hold', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ minutes: 23 }]) };
    await expect(checkoutHoldMinutes(tx as never, scope, 'b')).resolves.toBe(23);
    const sql = (tx.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sql).toContain('online_payment_hold_minutes');
    expect(sql).toContain('GREATEST(1,');
  });

  it('never gives less than one minute', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(checkoutHoldMinutes(tx as never, scope, 'b')).resolves.toBe(1);
  });
});
