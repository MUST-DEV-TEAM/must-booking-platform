import { describe, expect, it } from 'vitest';
import { AUDIT_CRITICAL_PATTERN, auditCsv, safeAuditValue } from './audit-workspace';
describe('safe recorded audit evidence', () => {
  it('removes credentials, location, session and actor fields recursively', () => {
    const safe = safeAuditValue(
      {
        password: 'secret',
        before: { stock: 7, api_key: 'secret', actorEmail: 'actor@example.test' },
        ip: '192.0.2.1',
        location: 'private',
        sessionId: 'credential',
        reason: 'actor@example.test changed stock',
        request: { requestId: 'safe-id' },
      },
      false,
      ['actor@example.test'],
    );
    expect(safe).toEqual({
      before: { stock: 7 },
      reason: '[identity hidden] changed stock',
      request: { requestId: 'safe-id' },
    });
  });
  it('keeps permitted actor wording but never credentials and bounds nesting', () => {
    expect(safeAuditValue({ actorEmail: 'a@example.test', token: 'credential' }, true)).toEqual({
      actorEmail: 'a@example.test',
    });
    expect(safeAuditValue({ value: 'x' }, true, [], 9)).toBe('[nested evidence omitted]');
  });
  it('writes BOM, quotes, CRLF and leading-whitespace formula protection', () => {
    const csv = auditCsv([
      ['Name', 'Value'],
      ['a"b', ' \t=1+1'],
      ['newline\nvalue', '@formula'],
    ]);
    expect(csv).toBe('\uFEFF"Name","Value"\r\n"a""b","\' \t=1+1"\r\n"newline\nvalue","\'@formula"');
  });
  it('classifies sensitive operations without treating a similarly named prefix as a role event', () => {
    const rule = new RegExp(AUDIT_CRITICAL_PATTERN);
    expect(rule.test('role.updated')).toBe(true);
    expect(rule.test('roleXunknown')).toBe(false);
    expect(rule.test('payment.refunded')).toBe(true);
    expect(rule.test('inventory_units.bulk_change')).toBe(false);
  });
});

it('protects formulas behind ASCII controls and Unicode whitespace without changing empty cells', () => {
  for (const text of ['\u0000\t=1', '\u001f+1', '\u007f-1', '\u2003@formula'])
    expect(auditCsv([[text]])).toBe('\uFEFF"\'' + text + '"');
  expect(auditCsv([['']])).toBe('\uFEFF""');
});
