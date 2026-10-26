import { describe, it, expect, vi } from 'vitest';
import {
  reportChartData,
  reportPreset,
  reportValue,
  reportSearch,
  reportRequest,
  ReportRequestError,
} from './report-presentation';
import { createReportWriter } from './report-writer';
describe('Report presentation without recalculating metrics', () => {
  it('deduplicates repeated nonmoney periods and separates money currencies', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', currency: 'EUR', bookings: 2, roomRevenue: '100.01' },
      { id: 'b', date: '2026-10-01', currency: 'USD', bookings: 2, roomRevenue: '200.02' },
    ];
    expect(
      reportChartData(rows, { key: 'bookings', label: 'Bookings', type: 'number' }).series,
    ).toEqual([{ name: 'Bookings', values: [2] }]);
    expect(
      reportChartData(rows, { key: 'roomRevenue', label: 'Revenue', type: 'money', money: true })
        .series,
    ).toEqual([
      { name: 'EUR', values: ['100.01'] },
      { name: 'USD', values: ['200.02'] },
    ]);
  });
  it('keeps exact monetary text and Unknown, without converting missing values to zero', () => {
    expect(reportValue('9007199254740993.99', 'money', 'EUR')).toBe('EUR 9007199254740993.99');
    expect(reportValue(null, 'percent')).toBe('Unknown');
    expect(reportValue(0, 'percent')).toBe('0.0%');
    expect(reportValue(2.90384615)).toBe('2.90');
  });
  it('uses property-local supplied today for date edges and avoids serializing absent filters', () => {
    expect(reportPreset('2026-01-01', 'week')).toEqual({ from: '2025-12-26', to: '2026-01-01' });
    expect(reportPreset('2024-02-29', 'month')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(reportSearch({ report: 'overview', status: undefined })).toBe('report=overview');
  });
  it('preserves a mutation key across an uncertain retry and changes it for new intent', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const write = createReportWriter();
    await expect(write('/views', 'POST', { name: 'one' })).rejects.toThrow('network');
    await write('/views', 'POST', { name: 'one' });
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(
      fetch.mock.calls[1][1].headers['Idempotency-Key'],
    );
    fetch.mockResolvedValue(new Response('{}'));
    await write('/views', 'POST', { name: 'two' });
    expect(fetch.mock.calls[2][1].headers['Idempotency-Key']).not.toBe(
      fetch.mock.calls[1][1].headers['Idempotency-Key'],
    );
    vi.unstubAllGlobals();
  });
  it('keeps failure references and blocks successful results on HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"message":"Refresh and review"}', {
            status: 409,
            headers: { 'x-request-id': 'report-ref' },
          }),
      ),
    );
    try {
      await reportRequest('/exports');
      throw new Error('unexpected');
    } catch (e) {
      expect(e).toBeInstanceOf(ReportRequestError);
      expect(e).toMatchObject({
        status: 409,
        reference: 'report-ref',
        message: 'Refresh and review',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
