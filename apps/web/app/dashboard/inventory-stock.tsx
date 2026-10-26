'use client';
import { inventorySelection, type InventoryPrefill } from './inventory-selection';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AvailabilityGrid, type AvailabilityGridCell } from '../../components/ui/availability-grid';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Combobox } from '../../components/ui/combobox';
import { MultiSelect } from '../../components/ui/multi-select';
import { CalendarPicker } from '../../components/ui/calendar-picker';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '../../components/ui/table';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { inventoryRequest, createInventoryWriter } from './inventory-api';
export type StockGrid = {
  source: 'LOCAL' | 'CLOCK_PMS';
  readOnly: boolean;
  bookingMode: string;
  today: string;
  timezone: string;
  startsOn: string;
  endsOn: string;
  explanation: string;
  rows: {
    id: string;
    label: string;
    days: {
      date: string;
      stock: number | null;
      soldHeld: number | null;
      remaining: number | null;
      blocked: boolean;
      markers: string[];
    }[];
  }[];
};
type Preview = {
  valid: boolean;
  previewToken: string;
  changes: {
    roomTypeId: string;
    date: string;
    before: number;
    after: number;
    soldHeld: number;
    remaining: number;
    error: string | null;
  }[];
};
const day = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
  (label, i) => ({ label, value: String(i + 1) }),
);
/** Bulk pool-stock editing with server preview, atomic confirmation and explicit source/mode boundaries. */
export function InventoryStock({
  base,
  canWrite,
  onCreate,
}: {
  base: string;
  canWrite: boolean;
  onCreate?: (kind: 'restrictions' | 'blocks', initial: InventoryPrefill) => void;
}) {
  const revision = useRef(0);
  const client = useQueryClient(),
    writer = useRef(createInventoryWriter());
  const [start, setStart] = useState(''),
    [selected, setSelected] = useState<AvailabilityGridCell[]>([]),
    [operation, setOperation] = useState('set'),
    [amount, setAmount] = useState('0'),
    [days, setDays] = useState(['1', '2', '3', '4', '5', '6', '7']),
    [range, setRange] = useState<{ start: string | null; end: string | null }>({
      start: null,
      end: null,
    }),
    [useRange, setUseRange] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [confirm, setConfirm] = useState(false);
  const query = useQuery({
    queryKey: ['dashboard', 'inventory-stock', base, start],
    queryFn: () => inventoryRequest<StockGrid>(`${base}/stock${start ? `?startsOn=${start}` : ''}`),
  });
  if (query.isPending) return <ListSkeleton />;
  if (query.error)
    return (
      <ErrorPanel
        title="Stock could not be loaded"
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  const data = query.data,
    editable =
      canWrite &&
      !data.readOnly &&
      data.source === 'LOCAL' &&
      ['ROOM_TYPE_ONLY', 'MIXED'].includes(data.bookingMode);
  const dirty = () => {
    revision.current += 1;
    setPreview(null);
    setPendingBody(null);
    setError('');
    setSuccess('');
  };
  const navigate = (date: string) => {
    dirty();
    setStart(date);
    setSelected([]);
    setUseRange(false);
    setRange({ start: null, end: null });
  };
  const invalidAmount =
    operation !== 'reset' &&
    (!/^\d+$/.test(amount) || !Number.isSafeInteger(Number(amount)) || Number(amount) > 2147483647);
  async function getPreview() {
    if (invalidAmount || !days.length) return;
    const requestRevision = revision.current;
    setBusy(true);
    setError('');
    setSuccess('');
    setPreview(null);
    setPendingBody(null);
    const body: Record<string, unknown> = {
      operation,
      value: Number(amount),
      weekdays: days.map(Number),
      ...(useRange
        ? {
            roomTypeIds: [...new Set(selected.map((c) => c.rowId))],
            startsOn: range.start,
            endsOn: range.end ? day(range.end, 1) : null,
          }
        : { cells: selected.map((c) => ({ roomTypeId: c.rowId, date: c.date })) }),
    };
    try {
      const result = await inventoryRequest<Preview>(`${base}/stock/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (requestRevision !== revision.current) return;
      setPreview(result);
      setPendingBody({ ...body, previewToken: result.previewToken });
    } catch (e) {
      if (requestRevision === revision.current)
        setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>{data.readOnly ? 'Read-only stock' : 'Room availability stock'}</AlertTitle>
        <AlertDescription>
          {data.explanation} Dates use {data.timezone}. Counts show stock and commitments; blocks
          and restrictions may further limit booking.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Stock</CardTitle>
          <CardDescription>
            {data.startsOn} through {day(data.endsOn, -1)}. Each cell shows stock, sold/held, then
            remaining.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => navigate(day(data.startsOn, -30))}>
              Previous 30 days
            </Button>
            <Button variant="outline" onClick={() => navigate(data.today)}>
              Today
            </Button>
            <CalendarPicker
              label="Jump to date"
              mode="single"
              value={{ start: data.startsOn, end: null }}
              onChange={(v) => v.start && navigate(v.start)}
            />
            <Button variant="outline" onClick={() => navigate(day(data.startsOn, 30))}>
              Next 30 days
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                dirty();
                void query.refetch();
              }}
            >
              Refresh stock
            </Button>
          </div>
          {data.rows.length ? (
            <>
              <p className="m-0 text-xs text-muted-foreground">
                {editable
                  ? 'Click cells, use Shift-click for a rectangular range, or select room-type rows and dates. Past dates are read-only.'
                  : 'Stock editing is unavailable for this view.'}
              </p>
              <AvailabilityGrid
                stock
                rows={data.rows.map((r) => ({
                  id: r.id,
                  label: r.label,
                  days: r.days.map((d) => ({
                    date: d.date,
                    capacity: d.stock,
                    available: d.remaining,
                    soldHeld: d.soldHeld,
                    note: d.markers.join(' ') || undefined,
                    marked: data.source === 'LOCAL' && (d.blocked || d.markers.length > 0),
                    disabled: d.date < data.today,
                  })),
                }))}
                selected={selected}
                onSelectionChange={
                  editable
                    ? (cells) => {
                        dirty();
                        setSelected(cells);
                      }
                    : undefined
                }
              />
            </>
          ) : (
            <EmptyPanel
              title="No room types yet"
              description="Add room types in Accommodations before configuring stock."
            />
          )}
        </CardContent>
      </Card>
      {editable && selected.length > 0 ? (
        <Card>
          <CardHeader>
            {onCreate ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    onCreate('restrictions', inventorySelection(selected, 'restrictions')!)
                  }
                >
                  Close dates / set a rule
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onCreate('blocks', inventorySelection(selected, 'blocks')!)}
                >
                  Block these dates
                </Button>
              </div>
            ) : null}
            <CardTitle>Edit stock - {selected.length} cells selected</CardTitle>
            <CardDescription>
              One change is applied atomically to all matching cells. Reset sets stock to 0 and is
              rejected if rooms are sold or held.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Operation">
                <Combobox
                  label="Stock operation"
                  value={operation}
                  onChange={(v) => {
                    dirty();
                    setOperation(v);
                  }}
                  options={[
                    { value: 'set', label: 'Set stock to' },
                    { value: 'add', label: 'Add to stock' },
                    { value: 'subtract', label: 'Subtract from stock' },
                    { value: 'reset', label: 'Reset stock to 0' },
                  ]}
                />
              </FormField>
              {operation !== 'reset' ? (
                <FormField
                  label="Number of rooms"
                  htmlFor="stock-amount"
                  error={invalidAmount ? 'Enter a non-negative whole number.' : null}
                >
                  <Input
                    id="stock-amount"
                    type="number"
                    min={0}
                    step={1}
                    value={amount}
                    onChange={(e) => {
                      dirty();
                      setAmount(e.target.value);
                    }}
                  />
                </FormField>
              ) : null}
              <FormField label="Apply on weekdays">
                <MultiSelect
                  label="Stock weekdays"
                  value={days}
                  options={weekdays}
                  onChange={(v) => {
                    dirty();
                    setDays(v);
                  }}
                  error={!days.length ? 'Choose at least one weekday.' : undefined}
                />
              </FormField>
              <FormField label="Dates to change">
                <Combobox
                  label="Stock date scope"
                  value={useRange ? 'range' : 'selected'}
                  onChange={(v) => {
                    dirty();
                    setUseRange(v === 'range');
                  }}
                  options={[
                    { value: 'selected', label: 'Selected grid cells' },
                    { value: 'range', label: 'Date range for selected room types' },
                  ]}
                />
              </FormField>
            </div>
            {useRange ? (
              <FormField label="Date range (both dates included)">
                <CalendarPicker
                  label="Stock date range"
                  mode="range"
                  value={range}
                  onChange={(v) => {
                    dirty();
                    setRange(v);
                  }}
                  minDate={data.today}
                />
              </FormField>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Stock was not changed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex gap-2">
              <Button
                loading={busy}
                disabled={
                  busy ||
                  invalidAmount ||
                  !days.length ||
                  (useRange && (!range.start || !range.end))
                }
                onClick={() => void getPreview()}
              >
                Preview changes
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  dirty();
                  setSelected([]);
                }}
              >
                Clear selection
              </Button>
            </div>
            {preview ? (
              <>
                <div className="max-h-80 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Room type / date</TableHead>
                        <TableHead>Before</TableHead>
                        <TableHead>After</TableHead>
                        <TableHead>Sold/held</TableHead>
                        <TableHead>Validation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.changes.map((c) => (
                        <TableRow key={`${c.roomTypeId}:${c.date}`}>
                          <TableCell>
                            {data.rows.find((r) => r.id === c.roomTypeId)?.label} / {c.date}
                          </TableCell>
                          <TableCell>{c.before}</TableCell>
                          <TableCell>{c.after}</TableCell>
                          <TableCell>{c.soldHeld}</TableCell>
                          <TableCell>
                            {c.error ? (
                              <span role="alert" className="text-destructive">
                                {c.date}: {c.error}
                              </span>
                            ) : (
                              'Valid'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button disabled={!preview.valid} onClick={() => setConfirm(true)}>
                  Save stock changes
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {success ? (
        <Alert role="status">
          <AlertTitle>Stock saved</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Apply stock changes?"
        description={`Apply the previewed stock to ${preview?.changes.length ?? 0} cells? Existing reservations stay unchanged.`}
        confirmLabel="Confirm stock change"
        confirmDisabled={!editable || !preview?.valid || !pendingBody}
        onConfirm={async () => {
          if (!editable || !pendingBody) return;
          await writer.current(`${base.slice(0, -10)}/inventory-units`, 'PUT', pendingBody);
          setSelected([]);
          setPreview(null);
          setPendingBody(null);
          setSuccess('The previewed stock changes were saved.');
          await client.invalidateQueries({ queryKey: ['dashboard', 'inventory-stock', base] });
          await client.invalidateQueries({ queryKey: ['dashboard', 'inventory'] });
        }}
      />
    </div>
  );
}
