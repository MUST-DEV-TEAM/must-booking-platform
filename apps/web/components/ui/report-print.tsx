'use client';
import type { ReportColumn, ReportRow, ReportWorkspace } from '../../lib/report-types';
import { reportValue } from '../../lib/report-presentation';
import { Button } from './button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table';
import { ReportEvidence } from './report-breakdown';
import { MetricDefinitions } from './metric-definitions';
export type PrintReport = {
  meta: ReportWorkspace['meta'];
  query: ReportWorkspace['query'];
  summary: Record<string, unknown>;
  columns: ReportColumn[];
  rows: ReportRow[];
};
/** Accessible audited print preview; the browser can print or save it as PDF. */
export function ReportPrint({
  model,
  onClose,
}: {
  model: PrintReport | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!model} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl" data-report-print="true">
        <DialogHeader>
          <DialogTitle>MUST Hotel report</DialogTitle>
          <DialogDescription>
            Audited snapshot. Print or choose Save as PDF in your browser.
          </DialogDescription>
        </DialogHeader>
        {model ? (
          <>
            <div className="print:hidden">
              <Button onClick={() => window.print()}>Print / Save as PDF</Button>
            </div>
            <p className="m-0 text-sm">
              {model.query.report}: {model.query.from} to {model.query.to}. {model.meta.basis}. Time
              zone: {model.meta.timezone}. As of {model.meta.asOf}.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  {model.columns.map((c) => (
                    <TableHead key={c.key}>{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.rows.map((r) => (
                  <TableRow key={r.id}>
                    {model.columns.map((c) => (
                      <TableCell key={c.key}>
                        {reportValue(r[c.key], c.type, String(r.currency ?? ''))}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h3 className="m-0 text-lg font-bold">Report summary</h3>
            <ReportEvidence value={model.summary} />
            <MetricDefinitions
              definitions={model.meta.definitions}
              timezone={model.meta.timezone}
              basis={model.meta.basis}
            />
          </>
        ) : null}
        <style>{`@media print {
          @page { size: A4 landscape; margin: 12mm; }
          html, body { overflow: visible !important; height: auto !important; margin: 0 !important; }
          body:has([data-report-print]) > *:not(:has([data-report-print])):not([data-report-print]) { display: none !important; }
          [data-report-print] { display: block !important; position: static !important; inset: auto !important; transform: none !important; translate: none !important; animation: none !important; width: 100% !important; max-width: none !important; max-height: none !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
          [data-report-print] > * { margin-bottom: 12pt; }
          [data-report-print] button { display: none !important; }
          [data-report-print] table { font-size: 9pt; }
          [data-report-print] thead { display: table-header-group; }
          [data-report-print] tr { break-inside: avoid; }
        }`}</style>
      </DialogContent>
    </Dialog>
  );
}
