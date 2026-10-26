import { describe, expect, it } from 'vitest';
import { emailDeliveryQuery } from './email-delivery-query';

describe('email delivery filters', () => {
  it('defaults to stable newest-first global ordering and keeps literal search bound', () => {
    const query = emailDeliveryQuery({ search: "_%' OR true--", recipient: ' ANA@Example.test ' });
    expect(query).toMatchObject({
      sort: 'created',
      direction: 'desc',
      recipient: 'ana@example.test',
    });
    expect(query.where.values).toContain("_%' or true--");
    expect(query.where.sql).not.toContain('OR true--');
    expect(query.where.sql).toContain('strpos');
    expect(query.order.sql).toContain('em.id DESC');
  });
  it.each([
    { from: '2026-02-29' },
    { from: '0000-01-01' },
    { to: '2026-04-31' },
    { from: '2026-12-31', to: '2026-01-01' },
    { from: '2024-01-01', to: '2025-01-01' },
    { sort: 'recipient;DROP TABLE email_messages' },
    { direction: 'sideways' },
    { status: 'UNKNOWN' },
    { filter: 'unknown' },
    { hours: 25 },
    { recipient: ['a', 'b'] },
  ])('rejects malformed filters: %j', (query) => {
    expect(() => emailDeliveryQuery(query)).toThrow();
  });
  it('accepts leap day and a 366-day inclusive interval, with exact combined status constraints', () => {
    expect(
      emailDeliveryQuery({
        from: '2024-01-01',
        to: '2024-12-31',
        filter: 'problems',
        status: 'SENT',
      }).where.values[0],
    ).toEqual([]);
    expect(emailDeliveryQuery({ from: '2024-02-29' }).from).toBe('2024-02-29');
  });
});
