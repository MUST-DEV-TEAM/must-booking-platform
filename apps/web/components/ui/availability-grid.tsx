'use client';
import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from './badge';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from './table';
export type AvailabilityGridCell = { rowId: string; date: string };
export type AvailabilityGridRow = {
  id: string;
  label: string;
  children?: readonly AvailabilityGridRow[];
  unit?: boolean;
  days: readonly {
    date: string;
    capacity: number | null;
    available: number | null;
    soldHeld?: number | null;
    note?: string;
    marked?: boolean;
    disabled?: boolean;
  }[];
};
/** Day coverage or selectable stock cells. Shift-click selects a rectangle; row/date checkboxes select groups. */
export function AvailabilityGrid({
  rows,
  selected = [],
  onSelectionChange,
  stock = false,
}: {
  rows: readonly AvailabilityGridRow[];
  selected?: readonly AvailabilityGridCell[];
  onSelectionChange?: (cells: AvailabilityGridCell[]) => void;
  stock?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const visibleRows = rows.flatMap((row) => [
    row,
    ...(expanded.has(row.id) ? (row.children ?? []) : []),
  ]);
  const anchor = useRef<AvailabilityGridCell | null>(null);
  const key = (c: AvailabilityGridCell) => c.rowId + ':' + c.date;
  const chosen = new Set(selected.map(key));
  const all = rows.flatMap((r) =>
    r.days.filter((d) => !d.disabled).map((d) => ({ rowId: r.id, date: d.date })),
  );
  function toggle(cells: AvailabilityGridCell[]) {
    const removing = cells.every((c) => chosen.has(key(c)));
    onSelectionChange?.(
      removing
        ? selected.filter((c) => !cells.some((x) => key(x) === key(c)))
        : [...selected, ...cells.filter((c) => !chosen.has(key(c)))],
    );
  }
  function select(cell: AvailabilityGridCell, shift: boolean) {
    if (shift && anchor.current) {
      const a = rows.findIndex((r) => r.id === anchor.current?.rowId),
        b = rows.findIndex((r) => r.id === cell.rowId);
      const dates = [anchor.current.date, cell.date].sort();
      onSelectionChange?.(
        all.filter((c) => {
          const i = rows.findIndex((r) => r.id === c.rowId);
          return (
            i >= Math.min(a, b) && i <= Math.max(a, b) && c.date >= dates[0]! && c.date <= dates[1]!
          );
        }),
      );
    } else {
      toggle([cell]);
      anchor.current = cell;
    }
  }
  return (
    <div className="max-h-[36rem] overflow-auto rounded-lg border" aria-label="Availability grid">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="min-w-44 sticky left-0 z-20 bg-card">
              {onSelectionChange ? (
                <Checkbox
                  aria-label="Select all stock cells"
                  disabled={!all.length}
                  checked={all.length > 0 && all.every((c) => chosen.has(key(c)))}
                  onCheckedChange={() => toggle(all)}
                />
              ) : null}{' '}
              {rows.some((row) => row.children?.length) ? 'Room type / room' : 'Room type'}
            </TableHead>
            {rows[0]?.days.map((day) => (
              <TableHead key={day.date} className="min-w-28 text-center">
                {onSelectionChange ? (
                  <Checkbox
                    aria-label={`Select date ${day.date}`}
                    disabled={!all.some((c) => c.date === day.date)}
                    checked={
                      all.some((c) => c.date === day.date) &&
                      all.filter((c) => c.date === day.date).every((c) => chosen.has(key(c)))
                    }
                    onCheckedChange={() => toggle(all.filter((c) => c.date === day.date))}
                  />
                ) : null}{' '}
                {day.date.slice(5)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="sticky left-0 bg-card font-semibold">
                {onSelectionChange && !row.unit ? (
                  <Checkbox
                    aria-label={`Select row ${row.label}`}
                    disabled={!all.some((c) => c.rowId === row.id)}
                    checked={
                      all.some((c) => c.rowId === row.id) &&
                      all.filter((c) => c.rowId === row.id).every((c) => chosen.has(key(c)))
                    }
                    onCheckedChange={() => toggle(all.filter((c) => c.rowId === row.id))}
                  />
                ) : null}{' '}
                {row.children?.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto max-w-44 justify-start whitespace-normal p-0 text-left sm:max-w-none sm:whitespace-nowrap"
                    aria-label={`${expanded.has(row.id) ? 'Hide' : 'Show'} rooms for ${row.label}`}
                    aria-expanded={expanded.has(row.id)}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      })
                    }
                  >
                    {expanded.has(row.id) ? (
                      <ChevronDown aria-hidden className="size-4 shrink-0" />
                    ) : (
                      <ChevronRight aria-hidden className="size-4 shrink-0" />
                    )}{' '}
                    {row.label} ({row.children.length} rooms)
                  </Button>
                ) : row.unit ? (
                  <span className="pl-5 font-normal">Room {row.label}</span>
                ) : (
                  row.label
                )}
              </TableCell>
              {row.days.map((day) => {
                const cell = { rowId: row.id, date: day.date },
                  content = stock ? (
                    <span className="flex flex-col gap-1 text-xs">
                      <span className="font-semibold">
                        {day.capacity === null ? 'Unknown' : `${day.capacity} stock`}
                      </span>
                      <span>
                        {day.soldHeld == null ? 'Managed in Clock' : `${day.soldHeld} sold/held`}
                      </span>
                      <span>
                        {day.available === null
                          ? 'Unknown remaining'
                          : `${day.available} remaining`}
                      </span>
                      {day.marked ? (
                        <Badge variant="warning">
                          {day.note?.includes('Blocked') ? 'Blocked' : 'Restricted'}
                        </Badge>
                      ) : null}
                    </span>
                  ) : (
                    <Badge variant={(day.available ?? 0) > 0 ? 'success' : 'secondary'}>
                      {row.unit ? (
                        day.available === null ? (
                          'Unknown'
                        ) : day.available > 0 ? (
                          'Available'
                        ) : (
                          'Unavailable'
                        )
                      ) : (
                        <>
                          {day.available}/{day.capacity}
                        </>
                      )}
                    </Badge>
                  );
                return (
                  <TableCell
                    key={day.date}
                    className={day.marked ? 'bg-warning/10 text-center' : 'text-center'}
                    title={day.note ?? `${day.available} available of ${day.capacity}`}
                  >
                    {onSelectionChange && !row.unit ? (
                      <Button
                        variant={chosen.has(key(cell)) ? 'secondary' : 'ghost'}
                        className="h-auto min-h-20 w-full px-2 py-2"
                        aria-label={`${row.label} ${day.date}: ${day.capacity} stock, ${day.soldHeld ?? 0} sold/held, ${day.available} remaining`}
                        aria-pressed={chosen.has(key(cell))}
                        disabled={day.disabled}
                        onClick={(e) => select(cell, e.shiftKey)}
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
