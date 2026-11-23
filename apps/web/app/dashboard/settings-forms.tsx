'use client';

import { useEffect, useState } from 'react';

import { useHotelSettings } from './hotel-settings-fields';
import { useUnsavedChanges } from '../../components/ui/unsaved-changes';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { FormField } from '../../components/ui/form-field';
import { FormSection } from '../../components/ui/form-section';
import { OptionCard } from '../../components/ui/option-card';
import { BookingRulesOverview } from './booking-rules-overview';
import { ruleOwnerLabel } from './booking-rules-owners';
import { Input, Textarea } from '../../components/ui/input';
import { HotelCurrencyNote } from './hotel-currency-note';
import { AlsoShowPrices, ExchangeRateTable } from './display-currencies-settings';
import { SaveBar } from '../../components/ui/save-bar';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { TimeField } from '../../components/ui/time-field';
import { policyPreviewLines, type PolicyPreviewLanguage } from './policy-preview';
import { validateRules, validTime, type BookingMode, type Property } from './settings-areas';

type Save = (update: Partial<Property>) => void;
type FormProps = { property: Property; saving: boolean; onSave: Save; canWrite?: boolean };
type GeneralProps = FormProps & { tenantId?: string };

/** The Profile tab: identity, location with the map pin, legal and tax, languages, currency, formats. */
export function GeneralSettings({
  property,
  saving,
  onSave,
  canWrite = false,
  tenantId,
}: GeneralProps) {
  // The exchange-rate controls need the dashboard's query client, so they are drawn only with a hotel scope.
  const currencyScope = tenantId
    ? { tenantId, propertyId: property.id, canWrite, refreshKey: property.defaultCurrency }
    : null;
  const rich = useHotelSettings(
    property,
    'general',
    canWrite,
    currencyScope
      ? {
          alsoShow: <AlsoShowPrices {...currencyScope} />,
          exchangeRates: <ExchangeRateTable {...currencyScope} />,
        }
      : undefined,
  );
  useUnsavedChanges(canWrite && rich.dirty);
  // A changed time zone moves the arrival times of existing bookings, so a hotel that has bookings confirms it first.
  const [confirmZone, setConfirmZone] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {rich.fields}
      <HotelCurrencyNote propertyId={property.id} refreshKey={property.defaultCurrency ?? ''} />
      <SaveBar
        dirty={canWrite && rich.dirty}
        saving={saving}
        canSave={!Object.keys(rich.errors).length}
        onSave={() =>
          rich.update.timezone && property.hasBookings ? setConfirmZone(true) : onSave(rich.update)
        }
        onDiscard={rich.discard}
      />
      <ConfirmDialog
        open={confirmZone}
        onOpenChange={setConfirmZone}
        title="Change the time zone?"
        description={`The hotel time zone changes to ${rich.update.timezone ?? ''}. Arrival times, same-day cutoffs and the dates shown for existing bookings follow it. The bookings themselves are not changed.`}
        confirmLabel="Change time zone"
        cancelLabel="Cancel"
        onConfirm={async () => {
          onSave(rich.update);
          setConfirmZone(false);
        }}
      />
    </div>
  );
}

const MODES: ReadonlyArray<{ value: BookingMode; label: string; hint: string }> = [
  {
    value: 'ROOM_TYPE_ONLY',
    label: 'By room type',
    hint: 'Guests book a room type; staff assign the room.',
  },
  {
    value: 'INDIVIDUAL_ROOM_ONLY',
    label: 'A specific room',
    hint: 'Guests pick the exact room they want.',
  },
  {
    value: 'MIXED',
    label: 'Both',
    hint: 'Guests can book either way: by room type or a specific room.',
  },
];

/** Stay limits, free cancellation, inventory mode and house rules. */
export function BookingRulesSettings({
  property,
  saving,
  onSave,
  canWrite = false,
  tenantId = '',
}: GeneralProps) {
  const connected = property.pmsSource === 'CLOCK_PMS';
  const rich = useHotelSettings(property, 'booking-rules', canWrite);
  const initial = () => ({
    freeCancellationDaysBeforeArrival: String(property.freeCancellationDaysBeforeArrival),
    rules: property.rules ?? '',
    bookingMode: property.bookingMode,
  });
  const [draft, setDraft] = useState(initial);
  const [confirmMode, setConfirmMode] = useState(false);
  useEffect(() => setDraft(initial()), [property]);
  const errors = validateRules(draft);
  const saved = initial();
  const dirty = (Object.keys(saved) as Array<keyof typeof saved>).some(
    (key) => saved[key] !== draft[key],
  );
  const combinedDirty = dirty || rich.dirty;
  useUnsavedChanges(canWrite && combinedDirty);
  const modeChanged = draft.bookingMode !== property.bookingMode;
  const commit = () => {
    const update: Partial<Property> = { ...rich.update };
    if (draft.freeCancellationDaysBeforeArrival !== saved.freeCancellationDaysBeforeArrival)
      update.freeCancellationDaysBeforeArrival = Number(draft.freeCancellationDaysBeforeArrival);
    if (draft.rules !== saved.rules) update.rules = draft.rules.trim() === '' ? null : draft.rules;
    if (modeChanged) update.bookingMode = draft.bookingMode;
    onSave(update);
  };
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <BookingRulesOverview tenantId={tenantId} property={property} />
      {rich.section(
        'Length of stay',
        'Booking window and season',
        'Same-day booking',
        'Arrival and departure days',
        'Group size',
        'Group requests',
        'Guest ages',
      )}
      <FormSection
        title="How guests choose rooms"
        badge={ruleOwnerLabel('How guests choose rooms', connected)}
        description="Changing this asks for confirmation. Existing bookings are not changed."
      >
        <div role="radiogroup" aria-label="How guests choose rooms" className="grid gap-3">
          {MODES.map((mode) => (
            <OptionCard
              key={mode.value}
              title={mode.label}
              description={mode.hint}
              selected={draft.bookingMode === mode.value}
              disabled={!canWrite}
              onSelect={() => set({ bookingMode: mode.value })}
            />
          ))}
        </div>
      </FormSection>
      {rich.section('Confirmation', 'Booking form', 'Advanced')}
      <FormSection
        title="Cancellation"
        badge={ruleOwnerLabel('Cancellation', connected)}
        description="The free-cancellation window is evaluated before arrival. Automatic refunds follow Payments settings; staff can handle a refund separately."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Free cancellation (days before arrival)"
            htmlFor="rules-cancel"
            hint="Whole days, 0 or more."
            error={errors.freeCancellationDaysBeforeArrival}
          >
            <Input
              disabled={!canWrite}
              id="rules-cancel"
              inputMode="numeric"
              value={draft.freeCancellationDaysBeforeArrival}
              onChange={(e) => set({ freeCancellationDaysBeforeArrival: e.target.value })}
            />
          </FormField>
        </div>
      </FormSection>
      <FormSection
        title="House rules"
        badge={ruleOwnerLabel('House rules', connected)}
        description="Shown on room detail pages unless a room has its own rules."
      >
        <FormField label="House rules" htmlFor="rules-text">
          <Textarea
            disabled={!canWrite}
            id="rules-text"
            rows={4}
            placeholder="Age restrictions, quiet hours, pets…"
            value={draft.rules}
            onChange={(e) => set({ rules: e.target.value })}
          />
        </FormField>
      </FormSection>
      {rich.section('No-show guidance')}
      <FormSection
        title="How online checkout works"
        description="Set by the system, shown here so staff know what to expect."
      >
        <p className="m-0 text-sm text-muted-foreground">
          When a guest starts a card payment the room is held for{' '}
          {property.onlinePaymentHoldMinutes ?? 30} minutes. If the payment is not completed the
          hold is released and the booking expires.
        </p>
      </FormSection>
      <SaveBar
        dirty={canWrite && combinedDirty}
        saving={saving}
        canSave={Object.keys(errors).length === 0 && !Object.keys(rich.errors).length}
        onSave={() => (modeChanged ? setConfirmMode(true) : commit())}
        onDiscard={() => {
          setDraft(initial());
          rich.discard();
        }}
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
export function CheckInOutSettings({ property, saving, onSave, canWrite = false }: FormProps) {
  const initial = {
    checkInTime: property.checkInTime ?? '',
    checkOutTime: property.checkOutTime ?? '',
  };
  const [draft, setDraft] = useState(initial);
  const [previewLanguage, setPreviewLanguage] = useState<PolicyPreviewLanguage>('en');
  const rich = useHotelSettings(property, 'check-in-out', canWrite, undefined, {
    checkInTime: draft.checkInTime || null,
    checkOutTime: draft.checkOutTime || null,
  });
  useEffect(() => setDraft(initial), [property.checkInTime, property.checkOutTime]);
  const errors = {
    checkInTime: validTime(draft.checkInTime) ? null : 'Use a time like 15:00.',
    checkOutTime: validTime(draft.checkOutTime) ? null : 'Use a time like 11:00.',
  };
  const dirty =
    rich.dirty ||
    draft.checkInTime !== initial.checkInTime ||
    draft.checkOutTime !== initial.checkOutTime;
  useUnsavedChanges(canWrite && dirty);
  const preview = [
    draft.checkInTime ? `Check-in from ${draft.checkInTime}` : null,
    draft.checkOutTime ? `Check-out by ${draft.checkOutTime}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const policyLines = policyPreviewLines(
    rich.values,
    { checkInTime: draft.checkInTime, checkOutTime: draft.checkOutTime },
    property.defaultCurrency ?? 'EUR',
    previewLanguage,
  );
  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Standard times"
        description="Shown to guests on the booking pages and in emails. They do not block or validate bookings."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Check-in from" htmlFor="times-in" error={errors.checkInTime}>
            <TimeField
              id="times-in"
              label="Check-in from"
              disabled={!canWrite}
              value={draft.checkInTime}
              onChange={(checkInTime) => setDraft({ ...draft, checkInTime })}
            />
          </FormField>
          <FormField label="Check-out by" htmlFor="times-out" error={errors.checkOutTime}>
            <TimeField
              id="times-out"
              label="Check-out by"
              disabled={!canWrite}
              value={draft.checkOutTime}
              onChange={(checkOutTime) => setDraft({ ...draft, checkOutTime })}
            />
          </FormField>
        </div>
        <p className="m-0 text-sm">
          <span className="text-muted-foreground">Guests will read: </span>
          <span className="font-semibold">{preview || 'No times are shown'}</span>
        </p>
      </FormSection>
      {rich.fields}
      <FormSection
        title="Guests will read"
        description="A preview of the policies as guests will read them. Nothing is shown to guests yet."
      >
        <SegmentedControl
          label="Preview language"
          value={previewLanguage}
          onChange={setPreviewLanguage}
          options={[
            { value: 'en', label: 'English' },
            { value: 'sq', label: 'Shqip' },
          ]}
        />
        {policyLines.length ? (
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm">
            {policyLines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">No policies set yet.</p>
        )}
      </FormSection>
      <SaveBar
        dirty={canWrite && dirty}
        saving={saving}
        canSave={!errors.checkInTime && !errors.checkOutTime && !Object.keys(rich.errors).length}
        onSave={() =>
          onSave({
            ...rich.update,
            ...(draft.checkInTime !== initial.checkInTime
              ? { checkInTime: draft.checkInTime || null }
              : {}),
            ...(draft.checkOutTime !== initial.checkOutTime
              ? { checkOutTime: draft.checkOutTime || null }
              : {}),
          })
        }
        onDiscard={() => {
          setDraft(initial);
          rich.discard();
        }}
      />
    </div>
  );
}
