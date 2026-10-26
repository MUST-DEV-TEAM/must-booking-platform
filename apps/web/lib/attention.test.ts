import { describe, expect, it } from 'vitest';

import { ATTENTION_STATUSES } from './reservation-display';
import { attentionIssue, PRIORITY_RANK } from './attention';

describe('attentionIssue', () => {
  it('describes every status the API treats as needing attention', () => {
    for (const status of ATTENTION_STATUSES) {
      const issue = attentionIssue(status);
      expect(issue.title).not.toBe('Needs review');
      expect(issue.reason.length).toBeGreaterThan(10);
      expect(issue.nextStep.length).toBeGreaterThan(10);
    }
  });

  it('puts failed payments in the payments group as urgent', () => {
    expect(attentionIssue('PAYMENT_FAILED')).toMatchObject({
      group: 'payments',
      priority: 'urgent',
    });
  });

  it('falls back to a generic review item for an unknown status', () => {
    expect(attentionIssue('SOMETHING_NEW')).toMatchObject({
      title: 'Needs review',
      priority: 'review',
    });
  });

  it('ranks urgent before review', () => {
    expect(PRIORITY_RANK.urgent).toBeLessThan(PRIORITY_RANK.review);
  });
});
