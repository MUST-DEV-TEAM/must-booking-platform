'use client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { StatTile } from '../../components/ui/stat-tile';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../../components/ui/table';
type Money = { amount: string; currency: string };
export type ClockFinancial = {
  fetchedAt: string;
  bookingVersion: number;
  balance: Money;
  paid: Money;
  refunded: Money;
  folios: Array<{
    id: string;
    deposit: boolean;
    value: Money;
    balance: Money;
    payments: Array<{ id: string; amount: Money; type: string; reference: string | null }>;
  }>;
};
export const moneyText = (money: Money) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: money.currency }).format(
    Number(money.amount),
  );
export function useClockFinancial(
  tenantId: string,
  propertyId: string,
  bookingId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['dashboard', 'clock-financial', tenantId, propertyId, bookingId],
    enabled,
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/clock-sync/financial/${bookingId}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw Error('Clock financial information could not be loaded.');
      return (await response.json()) as {
        data: ClockFinancial | null;
        status: string;
        lastError?: string | null;
      };
    },
    refetchInterval: 10000,
  });
}
export function ClockFinancialCard({
  data,
  status,
  error,
  localPaid,
}: {
  data?: ClockFinancial | null;
  status?: string;
  error?: string | null;
  localPaid: string;
}) {
  if (status === 'NOT_CONNECTED' || status === 'NOT_LINKED') return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verified Clock balance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p role="alert">{error} Last verified information remains visible.</p> : null}
        {!data ? (
          <p role="status">
            Clock bills and payments are being synchronized automatically. Collection will be
            available after the balance is verified.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Payments in Clock" value={moneyText(data.paid)} />
              <StatTile label="Refunds in Clock" value={moneyText(data.refunded)} />
              <StatTile
                label={
                  data.balance.amount.startsWith('-')
                    ? 'Guest credit in Clock'
                    : 'Outstanding in Clock'
                }
                value={moneyText({
                  ...data.balance,
                  amount: data.balance.amount.replace(/^-/, ''),
                })}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Checked {new Date(data.fetchedAt).toLocaleString()}. Clock totals already include
              payments mirrored from MUST; the two totals must not be added together.
            </p>
            {Number(data.paid.amount) !== Number(localPaid) ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                Clock contains payments beyond the MUST payment history. Review the entries below
                before deciding on a refund.
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Folio</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.folios.flatMap((f) =>
                    f.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {f.id}
                          {f.deposit ? ' (deposit)' : ''}
                        </TableCell>
                        <TableCell>
                          {p.amount.amount.startsWith('-')
                            ? 'Refund / adjustment'
                            : ['transfer', 'cross_account_transfer'].includes(p.type)
                              ? 'Internal transfer'
                              : 'Payment'}
                        </TableCell>
                        <TableCell>{moneyText(p.amount)}</TableCell>
                        <TableCell>{p.type.replaceAll('_', ' ')}</TableCell>
                        <TableCell className="max-w-64 break-words">
                          {p.reference || 'No reference supplied'}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </div>
            {!data.folios.some((f) => f.payments.length) ? (
              <p>No payments recorded in the synchronized Clock folios.</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
