import { describe, expect, it } from 'vitest';
import { parseReportQuery } from './report-query';
import { reportCsv, selectExport } from './report-workspace.service';
import { checkReportCap } from './report-facts.repository';

describe('Report query bounds and export primitives', () => {
  it('defaults to a property-local 30-day range and validates leap edges', () => {
    expect(parseReportQuery({}, '2026-01-01')).toMatchObject({
      from: '2025-12-03',
      to: '2026-01-01',
      page: 1,
      pageSize: 25,
      rowBasis: 'created',
      detail: 'default',
    });
    expect(parseReportQuery({ from: '2024-02-29', to: '2024-03-01' }, '2026-01-01').from).toBe(
      '2024-02-29',
    );
  });
  it.each([
    { from: '2025-02-29', to: '2025-03-01' },
    { from: '2026-02-01', to: '2026-01-01' },
    { from: '2024-01-01', to: '2025-01-01' },
    { to: [] },
    { page: 0 },
    { pageSize: 101 },
    { page: '1.5' },
    { report: 'sql' },
    { group: 'hour' },
    { comparison: 'future' },
    { sql: 'select' },
    { sort: 'amount;drop' },
    { roomTypeId: 'foreign' },
    { source: 'OTA' },
    { currency: 'eur' },
    { status: 'NO_SHOW' },
    { rowBasis: 'updated' },
    { report: 'occupancy', detail: 'refunds' },
  ])('fails closed for malformed or unsupported query %j', (query) => {
    expect(() => parseReportQuery(query, '2026-10-18')).toThrow();
  });
  it('accepts all supported filter forms without coercing arrays or booleans', () => {
    const id = '12345678-1234-4234-8234-123456789abc';
    expect(
      parseReportQuery(
        {
          report: 'revenue',
          detail: 'refunds',
          from: '2026-10-18',
          to: '2026-10-18',
          roomTypeId: id,
          currency: 'EUR',
          status: 'CONFIRMED',
          page: '2',
          pageSize: '100',
          rowBasis: 'payment',
        },
        '2026-10-18',
      ),
    ).toMatchObject({
      roomTypeId: id,
      page: 2,
      pageSize: 100,
      detail: 'refunds',
      rowBasis: 'payment',
    });
    expect(() => parseReportQuery({ page: true }, '2026-10-18')).toThrow();
  });
  it('never silently truncates a capped dataset', () => {
    expect(() => checkReportCap([1, 2], 2)).not.toThrow();
    expect(() => checkReportCap([1, 2, 3], 2)).toThrow('narrower');
  });
  it('exports exactly the visible column order and selected current-page rows', () => {
    const columns = [
      { key: 'name', label: 'Name', type: 'text' as const },
      { key: 'count', label: 'Count', type: 'number' as const },
    ];
    const rows = [
      { id: '1', name: 'First', count: 1 },
      { id: '2', name: 'Second', count: 2 },
    ];
    expect(selectExport(columns, rows, ['count', 'name'], ['2'])).toEqual({
      columns: [columns[1], columns[0]],
      rows: [rows[1]],
    });
    for (const [keys, ids] of [
      [['secret'], undefined],
      [['name'], ['off-page']],
      [['name', 'name'], undefined],
      [[], undefined],
      [['name'], ['1', '1']],
    ])
      expect(() => selectExport(columns, rows, keys, ids)).toThrow();
  });
  it('writes UTF-8 BOM, quotes CSV, and neutralizes formula/control prefixes', () => {
    const columns = [{ key: 'name', label: 'Name', type: 'text' as const }];
    const values = [
      '=SUM(A1:A2)',
      '  +cmd',
      '-2',
      '@SUM(A1)',
      '\tformula',
      '\rformula',
      '\nformula',
      'normal "quoted",value',
      'ë Guest',
    ];
    const csv = reportCsv(
      columns,
      values.map((name, i) => ({ id: String(i), name })),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    for (const value of values.slice(0, 7)) expect(csv).toContain('"\'' + value + '"');
    expect(csv).toContain('"normal ""quoted"",value"');
    expect(csv).toContain('ë Guest');
  });
});

it('keeps currency attached to exact monetary CSV cells even if its separate column is hidden', () => {
  expect(
    reportCsv(
      [{ key: 'amount', label: 'Amount', type: 'money', money: true }],
      [
        { id: 'a', currency: 'EUR', amount: '9007199254740993.99' },
        { id: 'b', currency: 'USD', amount: '-1.01' },
      ],
    ),
  ).toContain('"EUR 9007199254740993.99"');
  expect(
    reportCsv(
      [{ key: 'amount', label: 'Amount', type: 'money', money: true }],
      [{ id: 'b', currency: 'USD', amount: '-1.01' }],
    ),
  ).toContain('"USD -1.01"');
});
