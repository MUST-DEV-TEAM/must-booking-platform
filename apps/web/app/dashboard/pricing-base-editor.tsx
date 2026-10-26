'use client';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { Textarea } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { Combobox } from '../../components/ui/combobox';
import { MultiSelect } from '../../components/ui/multi-select';
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
import { createInventoryWriter, inventoryRequest } from './inventory-api';
import { weekdayOptions, priceDay, type PricingWorkspace } from './pricing-types';
import { DateField } from '../../components/ui/date-field';
type Preview = {
  valid?: boolean;
  errors?: { message: string; date?: string }[];
  version: number;
  previewToken: string;
  changes: {
    roomTypeId: string;
    date: string | null;
    before: string | null;
    after: string | null;
  }[];
};
/** Base and daily overrides use one server preview followed by an explicitly confirmed atomic write. */
export function PricingBaseEditor({
  base,
  data,
  initial,
  onClose,
  onSaved,
}: {
  base: string;
  data: PricingWorkspace;
  initial?: { roomTypeId?: string; date?: string; planId?: string; roomId?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const plans = data.plans.filter(
      (p) => p.pricingBasis === 'independent' && p.lifecycle !== 'Archived',
    ),
    writer = useRef(createInventoryWriter()),
    revision = useRef(0);
  const [planId, setPlanId] = useState(
      initial?.planId ?? plans.find((p) => p.isFallback)?.id ?? plans[0]?.id ?? '',
    ),
    [typeIds, setTypes] = useState(
      initial?.roomTypeId ? [initial.roomTypeId] : data.roomTypes.map((t) => t.id),
    ),
    [mode, setMode] = useState(initial?.roomId ? 'room' : initial?.date ? 'range' : 'all'),
    [start, setStart] = useState(initial?.date ?? data.today),
    [end, setEnd] = useState(initial?.date ?? priceDay(data.today, 6)),
    [weekdays, setDays] = useState(['1', '2', '3', '4', '5', '6', '7']),
    [operation, setOperation] = useState('set'),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [roomId, setRoom] = useState(initial?.roomId ?? ''),
    [preview, setPreview] = useState<Preview | null>(null),
    [intent, setIntent] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const plan = plans.find((p) => p.id === planId),
    dirty = () => {
      revision.current++;
      setPreview(null);
      setIntent(null);
      setError('');
    };
  async function previewChanges() {
    setError('');
    setBusy(true);
    const rev = revision.current;
    try {
      if (mode === 'room') {
        if (!roomId || !reason.trim() || (operation === 'set' && !amount))
          throw new Error('Choose a room, amount and change reason.');
        const current = data.roomOverrides.find(
          (r) => r.ratePlanId === planId && r.roomId === roomId,
        );
        if (operation === 'reset' && !current)
          throw new Error('There is no room override to remove.');
        setIntent({ amount, reason, version: current?.version ?? 0 });
        setPreview({
          version: data.pricingVersion,
          previewToken: 'room',
          changes: [
            {
              roomTypeId: data.rooms.find((r) => r.id === roomId)?.roomTypeId ?? '',
              date: null,
              before: current?.amount ?? null,
              after: operation === 'reset' ? null : amount,
            },
          ],
        });
        return;
      }
      const body = {
        ratePlanId: planId,
        roomTypeIds: typeIds,
        allYear: mode === 'all',
        startsOn: mode === 'all' ? null : start,
        endsOn: mode === 'all' ? null : priceDay(end, 1),
        weekdays: weekdays.map(Number),
        operation,
        amount,
        reason,
      };
      const result = await inventoryRequest<Preview>(`${base}/base-prices/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (rev !== revision.current) return;
      if (result.valid === false)
        throw new Error(
          (result.errors ?? []).map((e) => `${e.date ?? ''}: ${e.message}`).join('; '),
        );
      setPreview(result);
      setIntent({ ...body, version: result.version, previewToken: result.previewToken });
    } catch (e) {
      if (rev === revision.current) setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[44rem]">
          <DialogHeader>
            <DialogTitle>Edit base prices</DialogTitle>
            <DialogDescription>
              Tax-exclusive amounts; active rules and mandatory charges are applied by the shared
              pricing engine. Existing booking and issued quote totals are unchanged. Dates use{' '}
              {data.timezone}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Independent plan">
                <Combobox
                  label="Base price plan"
                  value={planId}
                  options={plans.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(v) => {
                    dirty();
                    setPlanId(v);
                  }}
                />
              </FormField>
              <FormField label="Edit scope">
                <Combobox
                  label="Base edit scope"
                  value={mode}
                  onChange={(v) => {
                    dirty();
                    setMode(v);
                    if (v === 'all') setOperation('set');
                  }}
                  options={[
                    { value: 'all', label: 'All-year base' },
                    { value: 'range', label: 'Selected date range' },
                    ...(data.bookingMode !== 'ROOM_TYPE_ONLY' && data.rooms.length
                      ? [{ value: 'room', label: 'Exact room override' }]
                      : []),
                  ]}
                />
              </FormField>
            </div>
            {mode === 'room' ? (
              <FormField label="Room">
                <Combobox
                  label="Room price override"
                  value={roomId}
                  options={data.rooms.map((r) => ({ value: r.id, label: r.name }))}
                  onChange={(v) => {
                    dirty();
                    setRoom(v);
                  }}
                />
              </FormField>
            ) : (
              <FormField label="Room types">
                <MultiSelect
                  label="Base price room types"
                  value={typeIds}
                  options={data.roomTypes.map((t) => ({ value: t.id, label: t.name }))}
                  onChange={(v) => {
                    dirty();
                    setTypes(v);
                  }}
                />
              </FormField>
            )}
            {mode === 'range' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="First date" htmlFor="base-start">
                  <DateField
                    id="base-start"
              aria-label="First date"

                    min={data.today}
                    value={start}
                    onChange={(date) => {
                      dirty();
                      setStart(date);
                    }}
                  />
                </FormField>
                <FormField label="Last date (included)" htmlFor="base-end">
                  <DateField
                    id="base-end"
              aria-label="Last date (included)"

                    min={start}
                    value={end}
                    onChange={(date) => {
                      dirty();
                      setEnd(date);
                    }}
                  />
                </FormField>
              </div>
            ) : null}
            {mode === 'range' ? (
              <FormField label="Weekdays">
                <MultiSelect
                  label="Base price weekdays"
                  value={weekdays}
                  options={weekdayOptions}
                  onChange={(v) => {
                    dirty();
                    setDays(v);
                  }}
                />
              </FormField>
            ) : null}
            {mode !== 'all' ? (
              <FormField label="Operation">
                <Combobox
                  label="Base price operation"
                  value={operation}
                  options={[
                    { value: 'set', label: 'Set fixed price' },
                    { value: 'reset', label: 'Remove override (restore underlying price)' },
                  ]}
                  onChange={(v) => {
                    dirty();
                    setOperation(v);
                  }}
                />
              </FormField>
            ) : null}
            {operation === 'set' ? (
              <FormField label="Amount" htmlFor="base-amount">
                <MoneyInput
                  id="base-amount"
                  value={amount}
                  currency={plan?.currency ?? 'EUR'}
                  onChange={(v) => {
                    dirty();
                    setAmount(v);
                  }}
                />
              </FormField>
            ) : null}
            <FormField label="Change reason" htmlFor="base-reason" required>
              <Textarea
                id="base-reason"
                value={reason}
                onChange={(e) => {
                  dirty();
                  setReason(e.target.value);
                }}
              />
            </FormField>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Prices were not changed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {preview ? (
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type / date</TableHead>
                      <TableHead>Before</TableHead>
                      <TableHead>After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.changes.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {data.roomTypes.find((t) => t.id === c.roomTypeId)?.name} /{' '}
                          {mode === 'room' ? 'Room override' : (c.date ?? 'All year')}
                        </TableCell>
                        <TableCell>{c.before ?? 'No override'}</TableCell>
                        <TableCell>{c.after ?? 'Underlying price / missing'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="outline"
              loading={busy}
              disabled={!planId || busy}
              onClick={() => void previewChanges()}
            >
              Preview changes
            </Button>
            {preview ? <Button onClick={() => setConfirm(true)}>Review and apply</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Apply price changes?"
        description={`Apply ${preview?.changes.length ?? 0} previewed changes? Booking and issued quote prices stay unchanged.`}
        confirmLabel="Confirm price change"
        confirmDisabled={!intent || !preview}
        onConfirm={async () => {
          if (!intent) return;
          if (mode === 'room') {
            await writer.current(
              `${base.slice(0, -8)}/rate-plans/${planId}/rooms/${roomId}/price-override`,
              operation === 'reset' ? 'DELETE' : 'PATCH',
              intent,
            );
          } else await writer.current(`${base}/base-prices`, 'PUT', intent);
          onSaved();
        }}
      />
    </>
  );
}
