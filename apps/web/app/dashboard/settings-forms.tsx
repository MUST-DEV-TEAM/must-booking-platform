'use client';

import { useEffect, useMemo, useState } from 'react';

import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { FormField } from '../../components/ui/form-field';
import { FormSection } from '../../components/ui/form-section';
import { Input, Textarea } from '../../components/ui/input';
import { SaveBar } from '../../components/ui/save-bar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  timeZoneOptions,
  validateRules,
  validTime,
  type BookingMode,
  type Property,
} from './settings-areas';

type Save = (update: Partial<Property>) => void;
type FormProps = { property: Property; saving: boolean; onSave: Save };

const text = (value: number | null) => (value === null ? '' : String(value));
const toNumber = (value: string): number | null => (value.trim() === '' ? null : Number(value));

/** Hotel name, address and time zone. */
export function GeneralSettings({ property, saving, onSave }: FormProps) {
  const initial = { name: property.name, address: property.address, timezone: property.timezone };
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [property.name, property.address, property.timezone]); // eslint-disable-line react-hooks/exhaustive-deps
  const zones = useMemo(() => timeZoneOptions(property.timezone), [property.timezone]);
  const errors = {
    name: draft.name.trim() ? null : 'Enter the hotel name.',
    address: draft.address.trim() ? null : 'Enter the hotel address.',
    timezone:
      !zones.length || zones.includes(draft.timezone) ? null : 'Choose a time zone from the list.',
  };
  const dirty =
    draft.name !== property.name ||
    draft.address !== property.address ||
    draft.timezone !== property.timezone;
  const save = () => {
    const update: Partial<Property> = {};
    if (draft.name !== property.name) update.name = draft.name.trim();
    if (draft.address !== property.address) update.address = draft.address.trim();
    if (draft.timezone !== property.timezone) update.timezone = draft.timezone;
    onSave(update);
  };
  return (
    <div className="flex flex-col gap-4">
      <FormSection title="Hotel identity" description="Shown to guests and in booking emails.">
        <FormField
          label="Hotel name"
          htmlFor="settings-name"
          required
          error={dirty ? errors.name : null}
        >
          <Input
            id="settings-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FormField>
        <FormField
          label="Address"
          htmlFor="settings-address"
          required
          error={dirty ? errors.address : null}
        >
          <Input
            id="settings-address"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
        </FormField>
        <FormField
          label="Time zone"
          htmlFor="settings-timezone"
          required
          hint="Dates, arrivals and same-day cutoffs follow this time zone."
          error={dirty ? errors.timezone : null}
        >
          {zones.length ? (
            <Combobox
              label="Time zone"
              value={draft.timezone}
              onChange={(timezone) => setDraft({ ...draft, timezone })}
              options={zones.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))}
              placeholder="Search time zones…"
              triggerClassName="w-full"
            />
          ) : (
            <Input
              id="settings-timezone"
              value={draft.timezone}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            />
          )}
        </FormField>
      </FormSection>
      <FormSection
        title="Currency"
        description="Prices are set per rate plan, so one hotel can sell in more than one currency. Change a currency under Rates & Pricing; existing bookings keep theirs."
      >
        <p className="m-0 text-sm text-muted-foreground">
          There is no single hotel currency to set here.
        </p>
      </FormSection>
      <SaveBar
        dirty={dirty}
        saving={saving}
        canSave={!errors.name && !errors.address && !errors.timezone}
        onSave={save}
        onDiscard={() => setDraft(initial)}
      />
    </div>
  );
}

const MODES: ReadonlyArray<{ value: BookingMode; label: string; hint: string }> = [
  {
    value: 'ROOM_TYPE_ONLY',
    label: 'Room types',
    hint: 'Guests book a room type; staff assign the room.',
  },
  {
    value: 'INDIVIDUAL_ROOM_ONLY',
    label: 'Individual rooms',
    hint: 'Guests book a specific room.',
  },
  { value: 'MIXED', label: 'Both', hint: 'Guests can book either way.' },
];

/** Stay limits, free cancellation, inventory mode and house rules. */
export function BookingRulesSettings({ property, saving, onSave }: FormProps) {
  const initial = () => ({
    minStayNights: text(property.minStayNights),
    maxStayNights: text(property.maxStayNights),
    advanceBookingDays: text(property.advanceBookingDays),
    freeCancellationDaysBeforeArrival: String(property.freeCancellationDaysBeforeArrival),
    rules: property.rules ?? '',
    bookingMode: property.bookingMode,
  });
  const [draft, setDraft] = useState(initial);
  const [confirmMode, setConfirmMode] = useState(false);
  useEffect(() => setDraft(initial()), [property]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = validateRules(draft);
  const saved = initial();
  const dirty = (Object.keys(saved) as Array<keyof typeof saved>).some(
    (key) => saved[key] !== draft[key],
  );
  const modeChanged = draft.bookingMode !== property.bookingMode;
  const commit = () => {
    const update: Partial<Property> = {};
    if (draft.minStayNights !== saved.minStayNights)
      update.minStayNights = toNumber(draft.minStayNights);
    if (draft.maxStayNights !== saved.maxStayNights)
      update.maxStayNights = toNumber(draft.maxStayNights);
    if (draft.advanceBookingDays !== saved.advanceBookingDays)
      update.advanceBookingDays = toNumber(draft.advanceBookingDays);
    if (draft.freeCancellationDaysBeforeArrival !== saved.freeCancellationDaysBeforeArrival)
      update.freeCancellationDaysBeforeArrival = Number(draft.freeCancellationDaysBeforeArrival);
    if (draft.rules !== saved.rules) update.rules = draft.rules.trim() === '' ? null : draft.rules;
    if (modeChanged) update.bookingMode = draft.bookingMode;
    onSave(update);
  };
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Stay limits"
        description="Applied to every booking, including staff bookings. Leave a limit empty for no limit."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Minimum stay (nights)" htmlFor="rules-min" error={errors.minStayNights}>
            <Input
              id="rules-min"
              inputMode="numeric"
              value={draft.minStayNights}
              onChange={(e) => set({ minStayNights: e.target.value })}
            />
          </FormField>
          <FormField label="Maximum stay (nights)" htmlFor="rules-max" error={errors.maxStayNights}>
            <Input
              id="rules-max"
              inputMode="numeric"
              value={draft.maxStayNights}
              onChange={(e) => set({ maxStayNights: e.target.value })}
            />
          </FormField>
          <FormField
            label="Booking window (days ahead)"
            htmlFor="rules-advance"
            hint="How far ahead guests can book."
            error={errors.advanceBookingDays}
          >
            <Input
              id="rules-advance"
              inputMode="numeric"
              value={draft.advanceBookingDays}
              onChange={(e) => set({ advanceBookingDays: e.target.value })}
            />
          </FormField>
        </div>
      </FormSection>
      <FormSection
        title="Cancellation"
        description="Guests cancelling at least this many days before arrival are refunded automatically. Closer to arrival they are asked to contact the hotel and staff handle it."
      >
        <FormField
          label="Free cancellation (days before arrival)"
          htmlFor="rules-cancel"
          error={errors.freeCancellationDaysBeforeArrival}
        >
          <Input
            id="rules-cancel"
            inputMode="numeric"
            className="sm:max-w-48"
            value={draft.freeCancellationDaysBeforeArrival}
            onChange={(e) => set({ freeCancellationDaysBeforeArrival: e.target.value })}
          />
        </FormField>
      </FormSection>
      <FormSection title="Inventory mode" description="How guests choose what to book.">
        <FormField
          label="Inventory mode"
          htmlFor="rules-mode"
          hint={MODES.find((m) => m.value === draft.bookingMode)?.hint}
        >
          <Select
            value={draft.bookingMode}
            onValueChange={(value) => set({ bookingMode: value as BookingMode })}
          >
            <SelectTrigger
              id="rules-mode"
              aria-label="Inventory mode"
              className="w-full sm:max-w-72"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </FormSection>
      <FormSection
        title="House rules"
        description="Shown on room detail pages unless a room has its own rules."
      >
        <FormField label="House rules" htmlFor="rules-text">
          <Textarea
            id="rules-text"
            rows={4}
            placeholder="Age restrictions, quiet hours, pets…"
            value={draft.rules}
            onChange={(e) => set({ rules: e.target.value })}
          />
        </FormField>
      </FormSection>
      <FormSection
        title="How online checkout works"
        description="Set by the system, shown here so staff know what to expect."
      >
        <p className="m-0 text-sm text-muted-foreground">
          When a guest starts a card payment the room is held for 30 minutes. If the payment is not
          completed the hold is released and the booking expires.
        </p>
      </FormSection>
      <SaveBar
        dirty={dirty}
        saving={saving}
        canSave={Object.keys(errors).length === 0}
        onSave={() => (modeChanged ? setConfirmMode(true) : commit())}
        onDiscard={() => setDraft(initial())}
      />
      <ConfirmDialog
        open={confirmMode}
        onOpenChange={setConfirmMode}
        title="Change the inventory mode?"
        description="This changes how guests choose rooms on the booking pages. Existing bookings are not changed."
        confirmLabel="Change mode"
        cancelLabel="Cancel"
        onConfirm={async () => {
          commit();
          setConfirmMode(false);
        }}
      />
    </div>
  );
}

/** Check-in and check-out times shown to guests. */
export function CheckInOutSettings({ property, saving, onSave }: FormProps) {
  const initial = {
    checkInTime: property.checkInTime ?? '',
    checkOutTime: property.checkOutTime ?? '',
  };
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [property.checkInTime, property.checkOutTime]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = {
    checkInTime: validTime(draft.checkInTime) ? null : 'Use a time like 15:00.',
    checkOutTime: validTime(draft.checkOutTime) ? null : 'Use a time like 11:00.',
  };
  const dirty =
    draft.checkInTime !== initial.checkInTime || draft.checkOutTime !== initial.checkOutTime;
  const preview = [
    draft.checkInTime ? `Check-in from ${draft.checkInTime}` : null,
    draft.checkOutTime ? `Check-out by ${draft.checkOutTime}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Standard times"
        description="Shown to guests on the booking pages and in emails. They do not block or validate bookings."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Check-in from" htmlFor="times-in" error={errors.checkInTime}>
            <Input
              id="times-in"
              type="time"
              value={draft.checkInTime}
              onChange={(e) => setDraft({ ...draft, checkInTime: e.target.value })}
            />
          </FormField>
          <FormField label="Check-out by" htmlFor="times-out" error={errors.checkOutTime}>
            <Input
              id="times-out"
              type="time"
              value={draft.checkOutTime}
              onChange={(e) => setDraft({ ...draft, checkOutTime: e.target.value })}
            />
          </FormField>
        </div>
        <p className="m-0 text-sm">
          <span className="text-muted-foreground">Guests will read: </span>
          <span className="font-semibold">{preview || 'No times are shown'}</span>
        </p>
      </FormSection>
      <SaveBar
        dirty={dirty}
        saving={saving}
        canSave={!errors.checkInTime && !errors.checkOutTime}
        onSave={() =>
          onSave({
            ...(draft.checkInTime !== initial.checkInTime
              ? { checkInTime: draft.checkInTime || null }
              : {}),
            ...(draft.checkOutTime !== initial.checkOutTime
              ? { checkOutTime: draft.checkOutTime || null }
              : {}),
          })
        }
        onDiscard={() => setDraft(initial)}
      />
    </div>
  );
}
