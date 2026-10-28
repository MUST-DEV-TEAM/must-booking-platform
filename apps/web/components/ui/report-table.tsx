'use client';
import { ScopedHotelMoney } from '../../app/dashboard/approximate-money';
import { useEffect, useState } from 'react';
import type { ReportColumn, ReportRow } from '../../lib/report-types';
import { reportValue } from '../../lib/report-presentation';
import { useTablePreferences } from '../../lib/use-table-preferences';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { BulkBar, ColumnChooser, DensityToggle } from './table-toolbar';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from './table';
import { SortableTableHead } from './sortable-table-head';
import { Pagination } from './pagination';
import { EmptyPanel } from './state-panel';
import { QuickPeek } from './quick-peek';
/** Server-sorted report table; copy/export both use the caller's audited export path. */
export function ReportTable({
  rows,
  columns,
  storageKey,
  page,
  pageSize,
  total,
  sort,
  direction,
  onSort,
  onPage,
  onPageSize,
  onExport,
  initialColumns,
  onVisibleColumns,
  missingReason,
}: {
  missingReason?: (key: string) => string;
  rows: ReportRow[];
  columns: ReportColumn[];
  storageKey: string;
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  direction: 'asc' | 'desc';
  onSort: (key: string) => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onExport: (keys: string[], ids?: string[], copy?: boolean) => Promise<void>;
  initialColumns?: string[];
  onVisibleColumns?: (columns: string[]) => void;
}) {
  const prefs = useTablePreferences(
    storageKey,
    Object.fromEntries(
      columns.map((c, i) => [c.key, initialColumns ? initialColumns.includes(c.key) : i < 7]),
    ),
  );
  const [selected, setSelected] = useState<string[]>([]),
    [peek, setPeek] = useState<ReportRow | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const cell = (row: ReportRow, c: ReportColumn) =>
    row[c.key] === null || row[c.key] === undefined ? (
      (missingReason?.(c.key) ?? 'Not recorded')
    ) : row[c.key] === 'Unknown' ? (
      'Not recorded'
    ) : c.type === 'money' && row.currency ? (
      <ScopedHotelMoney amount={String(row[c.key])} currency={String(row.currency)} />
    ) : (
      reportValue(row[c.key], c.type, String(row.currency ?? ''))
    );
  const shown = columns.filter((c, i) => i === 0 || prefs.columns[c.key]),
    ids = selected.filter((id) => rows.some((r) => r.id === id));
  const visibleSignature = JSON.stringify(shown.map((c) => c.key));
  useEffect(() => {
    onVisibleColumns?.(JSON.parse(visibleSignature) as string[]);
  }, [visibleSignature, onVisibleColumns]);
  const run = async (ids?: string[], copy?: boolean) => {
    setBusy(true);
    setError('');
    try {
      await onExport(
        shown.map((c) => c.key),
        ids,
        copy,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ColumnChooser
          labels={Object.fromEntries(columns.slice(1).map((c) => [c.key, c.label]))}
          visible={prefs.columns}
          onToggle={prefs.toggleColumn}
        />
        <DensityToggle compact={prefs.density === 'compact'} onToggle={prefs.toggleDensity} />
        <Button variant="outline" disabled={busy} onClick={() => void run()}>
          Export current page
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <BulkBar count={ids.length} onClear={() => setSelected([])}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(ids, true)}>
          Copy selected
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void run(ids)}>
          Export selected
        </Button>
      </BulkBar>
      {!rows.length ? (
        <EmptyPanel
          title="No rows in this report"
          description="No matching records. Try another period or clear filters."
        />
      ) : (
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>
                <Checkbox
                  aria-label="Select current page"
                  checked={ids.length === rows.length}
                  onCheckedChange={(checked) => setSelected(checked ? rows.map((r) => r.id) : [])}
                />
              </TableHead>
              {shown.map((c) => (
                <SortableTableHead
                  key={c.key}
                  active={sort === c.key}
                  direction={direction}
                  label={c.label}
                  onSort={() => onSort(c.key)}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => setPeek(row)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select ${row.id}`}
                    checked={ids.includes(row.id)}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? [...ids, row.id] : ids.filter((id) => id !== row.id))
                    }
                  />
                </TableCell>
                {shown.map((c, i) => (
                  <TableCell
                    key={c.key}
                    className={prefs.density === 'compact' ? 'py-1.5' : 'py-3'}
                  >
                    {c.type === 'link' && row[c.key] ? (
                      <a
                        href={String(row[c.key])}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary underline"
                      >
                        Open
                      </a>
                    ) : i === 0 ? (
                      <Button variant="ghost" size="sm" onClick={() => setPeek(row)}>
                        {cell(row, c)}
                      </Button>
                    ) : (
                      cell(row, c)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={onPage}
        pageSizeOptions={[10, 25, 50, 100]}
        onPageSize={onPageSize}
        noun="report rows"
      />
      <QuickPeek
        open={!!peek}
        onClose={() => setPeek(null)}
        title="Report row"
        description="Stored report evidence for the selected period."
      >
        {peek ? (
          <dl className="m-0 grid gap-3">
            {columns.map((c) => (
              <div key={c.key}>
                <dt className="text-xs text-muted-foreground">{c.label}</dt>
                <dd className="m-0 text-sm">
                  {c.type === 'link' && peek[c.key] ? (
                    <a className="text-primary underline" href={String(peek[c.key])}>
                      Open record
                    </a>
                  ) : (
                    cell(peek, c)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </QuickPeek>
    </div>
  );
}
