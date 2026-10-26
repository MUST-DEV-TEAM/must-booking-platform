import { Badge } from './badge';
import { Button } from './button';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from './table';
export type PriceGridRow = {
  id: string;
  label: string;
  days: readonly {
    date: string;
    amount: string | null;
    currency?: string | null;
    status: string;
    detail?: string;
  }[];
};
/** Readable decimal-string prices in a scrollable date grid; optional cell editing is owned by its caller. */
export function PriceGrid({
  rows,
  onCell,
  canEditCell,
}: {
  rows: readonly PriceGridRow[];
  canEditCell?: (rowId: string, date: string) => boolean;
  onCell?: (rowId: string, date: string) => void;
}) {
  return (
    <div className="max-h-[34rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="sticky left-0 z-20 min-w-44 bg-card">Room type</TableHead>
            {rows[0]?.days.map((d) => (
              <TableHead key={d.date} className="min-w-32 text-center">
                {d.date.slice(5)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="sticky left-0 bg-card font-semibold">{r.label}</TableCell>
              {r.days.map((d) => {
                const content = (
                  <span className="flex flex-col items-center gap-1">
                    <span className="font-semibold">
                      {d.amount === null ? 'Unknown' : `${d.currency ?? ''} ${d.amount}`.trim()}
                    </span>
                    <Badge variant={d.amount === null ? 'secondary' : 'outline'}>{d.status}</Badge>
                  </span>
                );
                return (
                  <TableCell key={d.date} title={d.detail} className="text-center">
                    {onCell ? (
                      <Button
                        disabled={canEditCell ? !canEditCell(r.id, d.date) : false}
                        variant="ghost"
                        className="h-auto min-h-16 w-full px-2 py-2"
                        aria-label={`Edit ${r.label} ${d.date}`}
                        onClick={() => onCell(r.id, d.date)}
                      >
                        {content}
                      </Button>
                    ) : (
                      content
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
