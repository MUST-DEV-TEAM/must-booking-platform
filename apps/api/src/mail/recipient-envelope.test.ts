import { expect, it } from 'vitest';
import { deduplicateRecipients, recipientEnvelope } from './recipient-envelope';
import { staffDeliveryGroups } from './notification-recipients';
import { applyRecipientOutcome } from './recipient-outcomes';

const envelope = { to: ['to@example.test'], cc: ['cc@example.test'], bcc: ['bcc@example.test'] };
it('deduplicates case-insensitively, preferring To over CC over BCC regardless of rule order', () => {
  expect(
    deduplicateRecipients([
      { email: 'DUP@example.test', channel: 'BCC' },
      { email: 'dup@example.test', channel: 'CC' },
      { email: 'Dup@example.test', channel: 'TO' },
      { email: 'private@example.test', channel: 'BCC' },
    ]),
  ).toEqual([
    { email: 'Dup@example.test', channel: 'TO' },
    { email: 'private@example.test', channel: 'BCC' },
  ]);
});
it('prepares one real envelope and a stable group identity instead of repeated CC copies', () => {
  const rows = [
    { staffUserId: 'first', email: 'to@example.test', channel: 'TO' as const },
    { staffUserId: 'copy', email: 'cc@example.test', channel: 'CC' as const },
    { staffUserId: 'hidden', email: 'bcc@example.test', channel: 'BCC' as const },
  ];
  expect(staffDeliveryGroups(rows)).toEqual([
    { ...rows[0], staffUserId: 'configured-staff-envelope', envelope },
  ]);
  expect(staffDeliveryGroups([{ staffUserId: 'legacy', email: 'private@example.test' }])).toEqual([
    { staffUserId: 'legacy', email: 'private@example.test' },
  ]);
});
it.each(
  [
    [],
    [{ email: 'copy@example.test', channel: 'CC' as const }],
    [{ email: 'bad\r\nBcc: victim@example.test' }],
    Array.from({ length: 101 }, (_, i) => ({ email: `staff${i}@example.test` })),
  ].map((rows) => ({ rows })),
)('refuses empty, missing-To, injected and oversized envelopes', ({ rows }) => {
  expect(() => recipientEnvelope(rows)).toThrow();
});
it('requires every recipient confirmation before an aggregate delivery claim', () => {
  const first = applyRecipientOutcome(envelope, {}, 'email.delivered', ['to@example.test'])!;
  expect(first.status).toBe('SENT');
  const second = applyRecipientOutcome(envelope, first.outcomes, 'email.delivered', [
    'cc@example.test',
  ])!;
  expect(second.status).toBe('SENT');
  expect(
    applyRecipientOutcome(envelope, second.outcomes, 'email.delivered', ['bcc@example.test'])!
      .status,
  ).toBe('DELIVERED');
});
it('attributes a private-recipient bounce only to that address, preserving later stronger outcomes', () => {
  const bounce = applyRecipientOutcome(envelope, {}, 'email.bounced', ['BCC@example.test'])!;
  expect(bounce).toEqual({
    recipient: 'bcc@example.test',
    outcomes: { 'bcc@example.test': 'BOUNCED' },
    status: 'BOUNCED',
  });
  const late = applyRecipientOutcome(envelope, bounce.outcomes, 'email.delivered', [
    'bcc@example.test',
  ])!;
  expect(late).toEqual(bounce);
  const complaint = applyRecipientOutcome(envelope, late.outcomes, 'email.complained', [
    'bcc@example.test',
  ])!;
  expect(
    applyRecipientOutcome(envelope, complaint.outcomes, 'email.bounced', ['bcc@example.test'])!
      .status,
  ).toBe('COMPLAINED');
});
it.each(
  [
    undefined,
    [],
    ['foreign@example.test'],
    ['to@example.test', 'cc@example.test'],
    'to@example.test',
  ].map((to) => ({ to })),
)(
  'does not infer a grouped recipient from an absent, ambiguous or unrelated webhook address: %j',
  ({ to }) => {
    expect(applyRecipientOutcome(envelope, {}, 'email.delivered', to)).toBeNull();
  },
);

it('does not fail a booking action when current staff resolution leaves only copies', () => {
  expect(
    staffDeliveryGroups([{ staffUserId: 'copy', email: 'copy@example.test', channel: 'CC' }]),
  ).toEqual([]);
});
it('does not let a late failed event replace delivery, or delivery resurrect a failed recipient', () => {
  expect(
    applyRecipientOutcome(envelope, { 'to@example.test': 'DELIVERED' }, 'email.failed', [
      'to@example.test',
    ])!.outcomes['to@example.test'],
  ).toBe('DELIVERED');
  expect(
    applyRecipientOutcome(envelope, { 'to@example.test': 'FAILED' }, 'email.delivered', [
      'to@example.test',
    ])!.outcomes['to@example.test'],
  ).toBe('FAILED');
});
