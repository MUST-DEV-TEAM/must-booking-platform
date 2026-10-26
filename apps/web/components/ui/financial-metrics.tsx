import { StatTile } from './stat-tile';
import { reportLabel, reportValue } from '../../lib/report-presentation';
export type FinancialMetricRow = {
  currency: string;
  collected: string;
  refunded: string;
  netCollected: string;
  outstanding: string;
  [key: string]: unknown;
};
/** Displays server-computed monetary metrics separately by currency with their stated date bases. */
export function FinancialMetrics({
  rows,
  onSelect,
  interactiveKeys,
}: {
  rows: FinancialMetricRow[];
  interactiveKeys?: string[];
  onSelect?: (key: string, currency: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.flatMap((row) =>
        ['collected', 'refunded', 'netCollected', 'outstanding', 'expectedOnArrival']
          .filter((key) => key in row)
          .map((key) => (
            <StatTile
              key={`${row.currency}:${key}`}
              label={`${reportLabel(key)} - ${row.currency}`}
              value={reportValue(row[key], 'money', row.currency)}
              note={
                key === 'outstanding'
                  ? 'Still owed by stays that have started. Where Clock holds the bill, Clock’s balance is used.'
                  : key === 'expectedOnArrival'
                    ? `Balance of stays that have not started yet, normally paid at the hotel on arrival.${
                        Number(row.expectedWithoutGuest ?? 0) > 0
                          ? ` ${reportValue(row.expectedWithoutGuest, 'money', row.currency)} of it is for stays with no guest name, often room blocks or tests made in Clock.`
                          : ''
                      }`
                    : 'Successful ledger postings in the selected period.'
              }
              onClick={
                onSelect && (!interactiveKeys || interactiveKeys.includes(key))
                  ? () => onSelect(key, row.currency)
                  : undefined
              }
            />
          )),
      )}
    </div>
  );
}
