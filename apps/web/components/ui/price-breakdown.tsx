import { Card, CardHeader, CardTitle, CardContent } from './card';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from './table';
export type PriceBreakdownData = {
  total: { amount: string; currency: string } | null;
  nightlyRates: {
    date: string;
    amount: string;
    components?: {
      kind: string;
      id: string;
      version: number;
      name: string;
      amount: string;
      display?: string;
    }[];
  }[];
};
/** Shows an immutable decimal-string price and its supplied calculation lines without recalculating it. */
export function PriceBreakdown({ value }: { value: PriceBreakdownData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Customer total:{' '}
          {value.total ? `${value.total.currency} ${value.total.amount}` : 'Unknown'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date / component</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {value.nightlyRates.flatMap((n) => [
              <TableRow key={n.date}>
                <TableCell className="font-semibold">{n.date}</TableCell>
                <TableCell className="font-semibold">{n.amount}</TableCell>
                <TableCell>Nightly total</TableCell>
              </TableRow>,
              ...(n.components ?? []).map((c, i) => (
                <TableRow key={`${n.date}:${c.kind}:${c.id}:${i}`}>
                  <TableCell className="pl-6">
                    {c.name}
                    {c.display ? ` (${c.display})` : ''}
                  </TableCell>
                  <TableCell>{c.amount}</TableCell>
                  <TableCell>
                    {c.kind} / v{c.version}
                  </TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
