import { reportLabel, reportValue } from '../../lib/report-presentation';
import { Card, CardHeader, CardTitle, CardContent } from './card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table';
const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
/** Compact, labeled aggregate evidence, including nested per-currency breakdowns. */
export function ReportEvidence({ value }: { value: unknown }) {
  if (scalar(value)) return <span>{value == null ? 'Not recorded' : reportValue(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length)
      return <span className="text-sm text-muted-foreground">No recorded activity</span>;
    if (
      value.every(
        (row) =>
          row && typeof row === 'object' && !Array.isArray(row) && Object.values(row).every(scalar),
      )
    ) {
      const keys = [...new Set(value.flatMap((row) => Object.keys(row)))].filter(
        (k) => k !== 'id' && k !== 'href',
      );
      return (
        <Table>
          <TableHeader>
            <TableRow>
              {keys.map((k) => (
                <TableHead key={k}>{reportLabel(k)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {value.map((row, i) => (
              <TableRow key={i}>
                {keys.map((k) => (
                  <TableCell key={k}>
                    {row[k] == null ? 'Not recorded' : reportValue(row[k])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {value.map((row, i) => (
          <div className="rounded-lg border p-3" key={i}>
            <ReportEvidence value={row} />
          </div>
        ))}
      </div>
    );
  }
  if (value && typeof value === 'object')
    return (
      <dl className="m-0 flex flex-col gap-3">
        {Object.entries(value).map(([key, v]) => (
          <div key={key} className="min-w-0">
            <dt className="mb-1 text-xs font-semibold text-muted-foreground">{reportLabel(key)}</dt>
            <dd className="m-0 text-sm">
              <ReportEvidence value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return null;
}
export function ReportBreakdown({ title, value }: { title: string; value: unknown }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ReportEvidence value={value} />
      </CardContent>
    </Card>
  );
}
