'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { reportRequest, ReportRequestError } from '../../lib/report-presentation';
import { reportNames, type ReportKind, type ReportQuery } from '../../lib/report-types';
import { RecordDirectory } from '../../components/ui/record-directory';
import { QuickPeek } from '../../components/ui/quick-peek';
import { ReportEvidence } from '../../components/ui/report-breakdown';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
type ExportRecord = {
  id: string;
  createdAt: string;
  report: ReportKind;
  format: string;
  rowCount: number;
  asOf: string;
  timezone: string;
  basis: string;
  filters: ReportQuery;
};
/** Your latest completed export audit metadata; files and failed attempts are not stored here. */
export function ReportExportHistory({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [peek, setPeek] = useState<ExportRecord | null>(null);
  const query = useQuery({
    queryKey: ['dashboard', 'report-exports', tenantId, propertyId],
    queryFn: () =>
      reportRequest<{ exports: ExportRecord[] }>(
        `/api/tenants/${tenantId}/properties/${propertyId}/reports/exports`,
      ),
    retry: false,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your recent completed exports</CardTitle>
        <CardDescription>
          The latest 50 audit records for this hotel. Re-export a report to create a fresh file with
          your current permissions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <ErrorPanel
            title="Export history unavailable"
            reference={
              query.error instanceof ReportRequestError ? query.error.reference : undefined
            }
            onRetry={() => void query.refetch()}
          />
        ) : (
          <RecordDirectory
            exportable={false}
            rows={query.data.exports}
            columns={[
              { id: 'report', label: 'Report', value: (r) => reportNames[r.report] ?? r.report },
              { id: 'format', label: 'Format', value: (r) => r.format },
              { id: 'rows', label: 'Rows', value: (r) => r.rowCount },
              {
                id: 'created',
                label: 'Exported',
                value: (r) =>
                  new Date(r.createdAt).toLocaleString(undefined, { timeZone: r.timezone }),
              },
            ]}
            storageKey={`must.reports.export-history.${propertyId}`}
            onRow={setPeek}
            emptyTitle="No completed exports yet"
          />
        )}
        <QuickPeek
          open={!!peek}
          onClose={() => setPeek(null)}
          title="Completed export"
          description="Audited filters and data basis."
        >
          {peek ? (
            <ReportEvidence
              value={{
                report: reportNames[peek.report],
                format: peek.format,
                rowCount: peek.rowCount,
                exportedAt: peek.createdAt,
                asOf: peek.asOf,
                timezone: peek.timezone,
                basis: peek.basis,
                filters: peek.filters,
              }}
            />
          ) : null}
        </QuickPeek>
      </CardContent>
    </Card>
  );
}
