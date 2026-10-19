'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { BulkBar, ColumnChooser, DensityToggle } from './table-toolbar';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from './table';
import { SortableTableHead } from './sortable-table-head';
import { SearchInput } from './search-input';
import { Pagination } from './pagination';
import { EmptyPanel, NoResultsPanel } from './state-panel';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './dropdown-menu';
import { useTablePreferences } from '../../lib/use-table-preferences';
export type RecordColumn<T> = {
  id: string;
  label: string;
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
};
export type RecordAction = { label: string; onSelect: () => void; disabled?: boolean };
/** Shared selectable, sortable directory with persistent columns/density and selected-row copy/CSV. */
export function RecordDirectory<T extends { id: string }>({
  rows,
  columns,
  storageKey,
  onRow,
  actions,
  emptyTitle = 'No records yet',
  exportable = true,
  pagination,
  initialSort,
}: {
  rows: readonly T[];
  columns: readonly RecordColumn<T>[];
  storageKey: string;
  onRow: (row: T) => void;
  actions?: (row: T) => RecordAction[];
  emptyTitle?: string;
  /** Disable local exports when the caller requires a dedicated audited export flow. */
  exportable?: boolean;
  /** Server window; selection/export applies to the loaded page only. */
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPage: (page: number) => void;
    onPageSize: (size: number) => void;
  };
}) {
  const defaults = Object.fromEntries(columns.slice(1).map((c) => [c.id, true]));
  const preferences = useTablePreferences(storageKey, defaults);
  const [search, setSearch] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [sort, setSort] = useState(
      initialSort ?? { key: columns[0].id, direction: 'asc' as 'asc' | 'desc' },
    ),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25),
    [error, setError] = useState('');
  const serverPage = pagination?.page,
    serverPageSize = pagination?.pageSize;
  useEffect(() => {
    if (serverPage !== undefined) setSelected([]);
  }, [serverPage, serverPageSize, rows]);
  const filtered = rows
    .filter((r) =>
      columns.some((c) => String(c.value(r)).toLowerCase().includes(search.toLowerCase())),
    )
    .sort((a, b) => {
      const col = columns.find((c) => c.id === sort.key)!;
      const av = col.value(a),
        bv = col.value(b);
      return (
        (typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true })) *
        (sort.direction === 'asc' ? 1 : -1)
      );
    });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize))),
    visible = pagination
      ? filtered
      : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    shown = columns.filter((c, i) => i === 0 || preferences.columns[c.id]);
  const selectedRows = rows.filter((r) => selected.includes(r.id));
  const csv = (items: readonly T[]) =>
    [columns.map((c) => c.label), ...items.map((r) => columns.map((c) => String(c.value(r))))]
      .map((row) =>
        row
          .map(
            (cell) =>
              `"${String(cell)
                .replace(/^[=+@-]/, "'$&")
                .replace(/"/g, '""')}"`,
          )
          .join(','),
      )
      .join('\r\n');
  function download(items: readonly T[]) {
    try {
      const url = URL.createObjectURL(new Blob([csv(items)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'records.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export could not be created. Try again.');
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="ml-auto w-64"
          aria-label={pagination ? 'Search this page' : 'Search records'}
          placeholder={pagination ? 'Search this page' : 'Search records'}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <ColumnChooser
          labels={Object.fromEntries(columns.slice(1).map((c) => [c.id, c.label]))}
          visible={preferences.columns}
          onToggle={preferences.toggleColumn}
        />
        <DensityToggle
          compact={preferences.density === 'compact'}
          onToggle={preferences.toggleDensity}
        />
        {exportable ? (
          <Button variant="outline" size="sm" onClick={() => download(filtered)}>
            {pagination ? 'Export page CSV' : 'Export CSV'}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {exportable ? (
        <BulkBar count={selectedRows.length} onClear={() => setSelected([])}>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(csv(selectedRows));
                setError('');
              } catch {
                setError('Copy could not complete. Use Export selected.');
              }
            }}
          >
            Copy selected
          </Button>
          <Button size="sm" variant="outline" onClick={() => download(selectedRows)}>
            Export selected
          </Button>
        </BulkBar>
      ) : null}
      {!rows.length ? (
        <EmptyPanel title={emptyTitle} />
      ) : !filtered.length ? (
        <NoResultsPanel onClear={() => setSearch('')} />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="max-h-[65vh] overflow-auto">
            <Table className="group" data-density={preferences.density}>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {exportable ? (
                    <TableHead>
                      <Checkbox
                        aria-label="Select all visible records"
                        checked={
                          visible.length > 0 && visible.every((r) => selected.includes(r.id))
                        }
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked
                              ? [...new Set([...selected, ...visible.map((r) => r.id)])]
                              : selected.filter((id) => !visible.some((r) => r.id === id)),
                          )
                        }
                      />
                    </TableHead>
                  ) : null}
                  {shown.map((c) => (
                    <SortableTableHead
                      key={c.id}
                      label={c.label}
                      active={sort.key === c.id}
                      direction={sort.direction}
                      onSort={() => {
                        setSort({
                          key: c.id,
                          direction: sort.key === c.id && sort.direction === 'asc' ? 'desc' : 'asc',
                        });
                        setPage(1);
                      }}
                    />
                  ))}
                  {actions ? (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id} onClick={() => onRow(r)} className="cursor-pointer">
                    {exportable ? (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${columns[0].value(r)}`}
                          checked={selected.includes(r.id)}
                          onCheckedChange={(checked) =>
                            setSelected(
                              checked ? [...selected, r.id] : selected.filter((id) => id !== r.id),
                            )
                          }
                        />
                      </TableCell>
                    ) : null}
                    {shown.map((c, i) => (
                      <TableCell
                        key={c.id}
                        className={preferences.density === 'compact' ? 'py-1' : 'py-3'}
                      >
                        {i === 0 ? (
                          <Button
                            variant="link"
                            className="h-auto p-0 text-left"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRow(r);
                            }}
                          >
                            {c.render?.(r) ?? c.value(r)}
                          </Button>
                        ) : (
                          (c.render?.(r) ?? c.value(r))
                        )}
                      </TableCell>
                    ))}
                    {actions ? (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Record actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {actions(r).map((a) => (
                              <DropdownMenuItem
                                key={a.label}
                                disabled={a.disabled}
                                onSelect={a.onSelect}
                              >
                                {a.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={pagination?.page ?? currentPage}
            pageSize={pagination?.pageSize ?? pageSize}
            total={pagination?.total ?? filtered.length}
            onPage={pagination?.onPage ?? setPage}
            pageSizeOptions={[10, 25, 50]}
            onPageSize={(size) => {
              if (pagination) {
                pagination.onPageSize(size);
                return;
              }
              setPageSize(size);
              setPage(1);
            }}
          />
        </Card>
      )}
    </div>
  );
}
