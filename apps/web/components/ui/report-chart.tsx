'use client';
import { useMemo } from 'react';
import { EChart, type ChartOption } from './echart';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './card';
import { reportChartData } from '../../lib/report-presentation';
import type { ReportColumn, ReportRow, ReportCell } from '../../lib/report-types';
const cents = (v: ReportCell): number | null => {
  if (v === null) return null;
  const text = String(v);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  let minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (text.startsWith('-')) minor = -minor;
  const n = Number(minor);
  return Number.isSafeInteger(n) ? n : null;
};
const decimal = (v: unknown) => {
  if (!/^-?\d+$/.test(String(v))) return 'Unknown';
  const n = BigInt(String(v)),
    sign = n < 0n ? '-' : '';
  const abs = n < 0n ? -n : n;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};
/** Shared themed report chart; money plots safe integer cents, never sums currencies. */
export function ReportChart({
  rows,
  column,
  comparison,
}: {
  rows: ReportRow[];
  column: ReportColumn;
  comparison?: ReportRow[];
}) {
  const option = useMemo<ChartOption>(() => {
    const current = reportChartData(rows, column),
      previous = comparison ? reportChartData(comparison, column) : null;
    const series = [
      ...current.series.map((s) => ({ ...s, previous: false })),
      ...(previous?.series.map((s) => ({ ...s, name: s.name + ' (comparison)', previous: true })) ??
        []),
    ];
    return {
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        valueFormatter: (v) => (v === null ? 'Unknown' : column.money ? decimal(v) : String(v)),
      },
      legend: { bottom: 0 },
      grid: { left: 70, right: 25, top: 20, bottom: 65 },
      xAxis: { type: 'category', data: current.dates },
      yAxis: {
        type: 'value',
        minInterval: column.money ? 1 : undefined,
        axisLabel: { formatter: (v: number) => (column.money ? decimal(v) : String(v)) },
      },
      series: series.map((s) => ({
        type: 'line',
        name: s.name,
        connectNulls: false,
        smooth: false,
        lineStyle: { type: s.previous ? 'dashed' : 'solid' },
        data: s.values.map((v) => (column.money ? cents(v) : typeof v === 'number' ? v : null)),
      })),
    };
  }, [rows, column, comparison]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{column.label}</CardTitle>
        <CardDescription>
          {column.money
            ? 'Separate currency lines. Values beyond safe chart precision stay Unknown; the table retains exact amounts.'
            : 'One value per period; repeated currency rows are counted once.'}{' '}
          Comparison aligns periods by position.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EChart option={option} />
      </CardContent>
    </Card>
  );
}
