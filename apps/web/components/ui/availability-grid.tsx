import { Badge } from './badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from './table';
export type AvailabilityGridRow = {
  id: string;
  label: string;
  days: readonly { date: string; capacity: number; available: number; note?: string }[];
};
/** Read-only day coverage from existing calendar facts; never implies eligibility for a full stay. */
export function AvailabilityGrid({ rows }: { rows: readonly AvailabilityGridRow[] }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="min-w-44">Room type</TableHead>
            {rows[0]?.days.map((day) => (
              <TableHead key={day.date} className="min-w-20 text-center">
                {day.date.slice(5)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-semibold">{row.label}</TableCell>
              {row.days.map((day) => (
                <TableCell
                  key={day.date}
                  className="text-center"
                  title={day.note ?? `${day.available} available of ${day.capacity}`}
                >
                  <Badge variant={day.available > 0 ? 'success' : 'secondary'}>
                    {day.available}/{day.capacity}
                  </Badge>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
