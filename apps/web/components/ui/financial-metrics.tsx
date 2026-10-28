import { ScopedHotelMoney } from '../../app/dashboard/approximate-money';
import { StatTile } from './stat-tile';
import { reportLabel } from '../../lib/report-presentation';
export type FinancialMetricRow = {
  currency: string;
  collected: string;
  refunded: string;
  netCollected: string;
  outstanding: string;
  [key: string]: unknown;
};
const METRIC_KEYS = ['collected', 'refunded', 'netCollected', 'outstanding', 'expectedOnArrival'];

/**
 * Displays server-computed monetary metrics separately by currency with their stated date bases. Each currency
 * is one row of cards on a wide screen, so lek and euro are never mixed in the same row.
 */
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
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const keys = METRIC_KEYS.filter((key) => key in row);
        return (
          <div
            key={row.currency}
            data-currency={row.currency}
            className={`grid gap-3 sm:grid-cols-2 ${keys.length >= 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}
          >
            {keys.map((key) => (
              <StatTile
                key={`${row.currency}:${key}`}
                label={`${reportLabel(key)} - ${row.currency}`}
                value={<ScopedHotelMoney amount={String(row[key])} currency={row.currency} />}
                note={
                  key === 'outstanding' ? (
                    'Still owed by stays that have started. Where Clock holds the bill, Clock’s balance is used.'
                  ) : key === 'expectedOnArrival' ? (
                    <>
                      Balance of stays that have not started yet, normally paid at the hotel on
                      arrival.
                      {Number(row.expectedWithoutGuest ?? 0) > 0 ? (
                        <>
                          {' '}
                          <ScopedHotelMoney
                            amount={String(row.expectedWithoutGuest)}
                            currency={row.currency}
                          />{' '}
                          of it is for stays with no guest name, often room blocks or tests made in
                          Clock.
                        </>
                      ) : (
                        ''
                      )}
                    </>
                  ) : (
                    'Successful ledger postings in the selected period.'
                  )
                }
                onClick={
                  onSelect && (!interactiveKeys || interactiveKeys.includes(key))
                    ? () => onSelect(key, row.currency)
                    : undefined
                }
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
