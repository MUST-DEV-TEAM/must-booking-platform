'use client';
import type { InventoryPrefill } from './inventory-selection';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Input, Textarea } from '../../components/ui/input';
import { Combobox } from '../../components/ui/combobox';
import { MultiSelect } from '../../components/ui/multi-select';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { Checkbox } from '../../components/ui/checkbox';
import { createInventoryWriter, inventoryRequest } from './inventory-api';
import {
  restrictionLabels,
  blockReasonLabels,
  type CatalogItem,
  type InventoryRecord,
  type StaffChoice,
} from './inventory-types';
import { DateField } from '../../components/ui/date-field';
/** Shared Inventory editing flow; server validation and activation remain authoritative. */
export function InventoryEditor({
  kind,
  record,
  initial,
  base,
  today,
  timezone,
  catalog,
  categories,
  rooms,
  staff,
  bookingMode,
  onClose,
  onSaved,
}: {
  kind: 'restrictions' | 'blocks';
  record?: InventoryRecord;
  initial?: InventoryPrefill;
  base: string;
  today: string;
  timezone: string;
  catalog: CatalogItem[];
  categories: CatalogItem[];
  rooms: CatalogItem[];
  staff: StaffChoice[] | null;
  bookingMode: string;
  onClose: () => void;
  onSaved: (record: InventoryRecord) => void;
}) {
  const rule = kind === 'restrictions';
  const [saved, setSaved] = useState(record),
    [name, setName] = useState(record?.name ?? record?.title ?? ''),
    [type, setType] = useState(record?.type ?? initial?.type ?? 'minimum_stay'),
    [value, setValue] = useState(record?.value ?? 1),
    [scope, setScope] = useState(
      rule
        ? (record?.scope ?? initial?.scope ?? 'property')
        : record?.all === false || initial?.all === false
          ? 'targets'
          : 'property',
    ),
    [targetIds, setTargets] = useState(record?.targetIds ?? initial?.targetIds ?? []),
    [roomTypeIds, setTypes] = useState(record?.roomTypeIds ?? initial?.roomTypeIds ?? []),
    [roomIds, setRooms] = useState(record?.roomIds ?? []),
    [startsOn, setStart] = useState(record?.startsOn ?? initial?.startsOn ?? today),
    [endsOn, setEnd] = useState(record?.endsOn ?? initial?.endsOn ?? ''),
    [weekdays, setWeekdays] = useState((record?.weekdays ?? [1, 2, 3, 4, 5, 6, 7]).map(String)),
    [priority, setPriority] = useState(record?.priority ?? 50),
    [note, setNote] = useState(record?.internalReason ?? record?.note ?? ''),
    [reason, setReason] = useState(record?.reason ?? 'maintenance'),
    [reference, setReference] = useState(record?.reference ?? ''),
    [responsible, setResponsible] = useState(record?.responsibleStaffId ?? ''),
    [endReason, setEndReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [validation, setValidation] = useState('');
  const writer = useRef(createInventoryWriter());
  const locked = !rule && (record?.scopeLocked || record?.lifecycle === 'Active');
  const payload = () =>
    rule
      ? {
          name,
          type,
          value,
          scope,
          targetIds: scope === 'property' ? [] : targetIds,
          startsOn,
          endsOn: endsOn || null,
          weekdays: weekdays.map(Number),
          priority,
          internalReason: note,
        }
      : {
          title: name,
          reason,
          all: scope === 'property',
          roomTypeIds: scope === 'property' ? [] : roomTypeIds,
          roomIds: scope === 'property' ? [] : roomIds,
          startsOn,
          endsOn,
          responsibleStaffId: responsible || null,
          reference,
          note,
          endReason,
        };
  async function validate() {
    const response = await inventoryRequest<{
      valid: boolean;
      conflicts: { reference?: string; name?: string; id: string }[];
      errors: { message: string }[];
    }>(`${base}/${kind}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload(), ...(saved ? { id: saved.id } : {}) }),
    });
    if (!response.valid)
      throw new Error(
        [
          ...response.errors.map((e) => e.message),
          ...response.conflicts.map((c) => `Conflicts with ${c.reference ?? c.name ?? c.id}`),
        ].join('. ') || 'Validation failed.',
      );
    setValidation('Validation passed. Activation checks again before applying.');
  }
  async function save(activate: boolean) {
    setBusy(true);
    setError('');
    try {
      if (activate) await validate();
      const next = await writer.current<InventoryRecord>(
        `${base}/${kind}${saved ? '/' + saved.id : ''}`,
        saved ? 'PATCH' : 'POST',
        { ...payload(), ...(saved ? { version: saved.version } : {}) },
      );
      setSaved(next);
      const result = activate
        ? await writer.current<InventoryRecord>(`${base}/${kind}/${next.id}/activate`, 'POST', {
            version: next.version,
          })
        : next;
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The record could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>
            {saved ? 'Edit' : 'Create'} {rule ? 'restriction' : 'manual block'}
          </DialogTitle>
          <DialogDescription>
            {initial
              ? 'Prefilled from the selected room types and earliest through latest date. Gaps inside this range are included; review scope and dates before saving. '
              : null}
            {timezone}.{' '}
            {rule
              ? 'Restrictions do not change existing bookings or prices.'
              : 'Date-based only. Available-again is exclusive. No reservation is cancelled.'}
            {saved ? ` Version ${saved.version}.` : ''}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <FormField label={rule ? 'Rule name' : 'Block title'} htmlFor="inventory-name" required>
              <Input
                id="inventory-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setValidation('');
                }}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              {rule ? (
                <>
                  <FormField label="Rule type">
                    <Combobox
                      label="Rule type"
                      value={type}
                      options={Object.entries(restrictionLabels).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      onChange={(v) => {
                        setType(v);
                        setValue(1);
                        setValidation('');
                      }}
                    />
                  </FormField>
                  <FormField
                    label={
                      ['stop_sell', 'closed_to_arrival', 'closed_to_departure'].includes(type)
                        ? 'Effect'
                        : 'Value'
                    }
                    hint={
                      type === 'minimum_advance'
                        ? 'Whole days before arrival.'
                        : type.includes('stay')
                          ? 'Number of nights.'
                          : '1 = closed, 0 = open exception.'
                    }
                    htmlFor="restriction-value"
                  >
                    <Input
                      id="restriction-value"
                      type="number"
                      required
                      min={type.includes('stay') ? 1 : 0}
                      max={
                        ['stop_sell', 'closed_to_arrival', 'closed_to_departure'].includes(type)
                          ? 1
                          : 2147483647
                      }
                      step={1}
                      value={value}
                      onChange={(e) => {
                        setValue(Number(e.target.value));
                        setValidation('');
                      }}
                    />
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label="Reason">
                    <Combobox
                      label="Block reason"
                      value={reason}
                      options={Object.entries(blockReasonLabels).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      onChange={setReason}
                    />
                  </FormField>
                  <FormField label="Work order reference" htmlFor="block-reference">
                    <Input
                      id="block-reference"
                      maxLength={80}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </FormField>
                </>
              )}
            </div>
            <FormField
              label="Scope"
              hint={
                locked
                  ? 'Scope is locked after activation. End this block and create another to change it.'
                  : undefined
              }
            >
              <Combobox
                label="Inventory scope"
                disabled={Boolean(locked)}
                value={scope}
                options={
                  rule
                    ? [
                        { value: 'property', label: 'Entire property' },
                        { value: 'category', label: 'Categories' },
                        { value: 'room_type', label: 'Room types' },
                      ]
                    : [
                        { value: 'property', label: 'Entire property' },
                        { value: 'targets', label: 'Selected room types or rooms' },
                      ]
                }
                onChange={(v) => {
                  setScope(v);
                  setTargets([]);
                  setValidation('');
                }}
              />
            </FormField>
            {rule && scope !== 'property' ? (
              <FormField label={scope === 'category' ? 'Categories' : 'Room types'}>
                <MultiSelect
                  label="Restriction targets"
                  options={(scope === 'category' ? categories : catalog).map((t) => ({
                    value: t.id,
                    label: t.name,
                  }))}
                  value={targetIds}
                  onChange={(v) => {
                    setTargets(v);
                    setValidation('');
                  }}
                  placeholder="Choose targets"
                />
              </FormField>
            ) : null}
            {!rule && scope !== 'property' ? (
              <>
                <FormField label="Room types">
                  <MultiSelect
                    label="Block room types"
                    disabled={Boolean(locked)}
                    options={catalog.map((t) => ({ value: t.id, label: t.name }))}
                    value={roomTypeIds}
                    onChange={(v) => {
                      setTypes(v);
                      setValidation('');
                    }}
                    placeholder="Choose room types"
                  />
                </FormField>
                {bookingMode !== 'ROOM_TYPE_ONLY' ? (
                  <FormField label="Rooms">
                    <MultiSelect
                      label="Block rooms"
                      disabled={Boolean(locked)}
                      options={rooms.map((r) => ({
                        value: r.id,
                        label: r.name,
                        group: catalog.find((t) => t.id === r.roomTypeId)?.name,
                      }))}
                      value={roomIds}
                      onChange={(v) => {
                        setRooms(v);
                        setValidation('');
                      }}
                      placeholder="Choose exact rooms"
                    />
                  </FormField>
                ) : null}
              </>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Start date" htmlFor="inventory-start" required>
                <DateField
                  id="inventory-start"
              aria-label="Start date"
                  value={startsOn}
                  onChange={(date) => {
                    setStart(date);
                    setValidation('');
                  }}
                />
              </FormField>
              <FormField
                label={rule ? 'End date (inclusive)' : 'Available again (exclusive)'}
                htmlFor="inventory-end"
                required={!rule}
              >
                <DateField
                  id="inventory-end"
                  value={endsOn}
                  onChange={(date) => {
                    setEnd(date);
                    setValidation('');
                  }}
                />
              </FormField>
            </div>
            {rule ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!endsOn}
                    onCheckedChange={(checked) => {
                      setEnd(checked ? '' : startsOn);
                      setValidation('');
                    }}
                  />
                  No end date
                </label>
                <FormField label="Weekdays">
                  <MultiSelect
                    label="Applicable weekdays"
                    searchable={false}
                    options={[
                      'Monday',
                      'Tuesday',
                      'Wednesday',
                      'Thursday',
                      'Friday',
                      'Saturday',
                      'Sunday',
                    ].map((label, i) => ({ value: String(i + 1), label }))}
                    value={weekdays}
                    onChange={(v) => {
                      setWeekdays(v);
                      setValidation('');
                    }}
                  />
                </FormField>
                <FormField
                  label="Priority"
                  htmlFor="restriction-priority"
                  hint="Higher wins within one type. Contradicting equal-priority rules cannot activate."
                >
                  <Input
                    id="restriction-priority"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    required
                    value={priority}
                    onChange={(e) => {
                      setPriority(Number(e.target.value));
                      setValidation('');
                    }}
                  />
                  <div className="flex flex-wrap gap-1">
                    {[
                      [25, 'Low'],
                      [50, 'Normal'],
                      [75, 'High'],
                      [100, 'Critical'],
                    ].map(([n, label]) => (
                      <Button
                        key={n}
                        type="button"
                        variant={priority === n ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => {
                          setPriority(Number(n));
                          setValidation('');
                        }}
                      >
                        {label} {n}
                      </Button>
                    ))}
                  </div>
                </FormField>
              </>
            ) : staff ? (
              <FormField label="Responsible staff">
                <Combobox
                  label="Responsible staff"
                  value={responsible}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...staff
                      .filter((s) => !s.suspendedAt && s.status !== 'SUSPENDED')
                      .map((s) => ({
                        value: s.userId,
                        label: [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email,
                      })),
                  ]}
                  onChange={setResponsible}
                />
              </FormField>
            ) : null}
            <FormField label={rule ? 'Internal reason' : 'Notes'} htmlFor="inventory-notes">
              <Textarea
                id="inventory-notes"
                maxLength={rule ? 4000 : 500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            {!rule && record?.lifecycle === 'Active' ? (
              <FormField label="Reason for shortening the active period" htmlFor="block-end-reason">
                <Textarea
                  id="block-end-reason"
                  maxLength={4000}
                  value={endReason}
                  onChange={(e) => setEndReason(e.target.value)}
                />
              </FormField>
            ) : null}
          </fieldset>
          {validation ? (
            <Alert>
              <AlertTitle>{validation}</AlertTitle>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Nothing was activated</AlertTitle>
              <AlertDescription>
                {error}
                {saved && !record ? ' Your draft was saved and is preserved.' : ''}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                setValidation('');
                try {
                  await validate();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Validation failed.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Validate
            </Button>
            <Button type="submit" variant="outline" disabled={busy}>
              {saved ? 'Save changes' : 'Save draft'}
            </Button>
            {!saved || saved.lifecycle === 'Draft' || (rule && saved.lifecycle === 'Paused') ? (
              <Button type="button" disabled={busy} onClick={() => void save(true)}>
                Save and activate
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
