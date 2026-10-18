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
import { Input, Textarea } from '../../components/ui/input';
import { Combobox } from '../../components/ui/combobox';
import { MultiSelect } from '../../components/ui/multi-select';
import { Checkbox } from '../../components/ui/checkbox';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { TabBar } from '../../components/ui/tab-bar';
import { createInventoryWriter } from './inventory-api';
import {
  chargeBases,
  mealOptions,
  weekdayOptions,
  type PricingKind,
  type PricingRecord,
  type PricingWorkspace,
} from './pricing-types';
/** Versioned pricing create/edit dialog composed from shared fields; failed publication retains its saved draft. */
export function PricingEditor({
  base,
  kind,
  record,
  data,
  onClose,
  onSaved,
  onStored,
}: {
  base: string;
  kind: PricingKind;
  record?: PricingRecord;
  data: PricingWorkspace;
  onClose: () => void;
  onSaved: (r: PricingRecord) => void;
  onStored: () => void;
}) {
  const [saved, setSaved] = useState(record),
    [fields, setFields] = useState<Record<string, unknown>>({
      ...record,
      name: record?.name ?? '',
      description: record?.description ?? '',
      currency: record?.currency ?? 'EUR',
      pricingBasis: record?.pricingBasis ?? 'independent',
      basePlanId: record?.basePlanId ?? '',
      adjustmentKind: record?.adjustmentKind ?? 'percentage',
      adjustmentValue: record?.adjustmentValue ?? '0',
      roomTypeIds: record?.roomTypeIds ?? [],
      ratePlanIds: record?.ratePlanIds ?? [],
      channels: record?.channels ?? ['website', 'staff'],
      mealPlan: record?.mealPlan ?? 'room_only',
      startsOn: record?.startsOn ?? data.today,
      endsOn: record?.endsOn ?? '',
      weekdays: record?.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
      mode: record?.mode ?? 'percentage',
      value: record?.value ?? '',
      priority: record?.priority ?? 50,
      basis: record?.basis ?? 'percentage_accommodation',
      display: record?.display ?? 'included',
      confirmed: record?.confirmed ?? false,
      note: record?.note ?? '',
      changeReason: '',
    }),
    [step, setStep] = useState('identity'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const writer = useRef(createInventoryWriter());
  const set = (key: string, value: unknown) => {
    setFields((f) => ({ ...f, [key]: value }));
    setError('');
  };
  const str = (key: string) => String(fields[key] ?? '');
  const list = (key: string) => (Array.isArray(fields[key]) ? (fields[key] as string[]) : []);
  const numberField = (key: string, label: string, min = 0) => (
    <FormField key={key} label={label} htmlFor={`pricing-${key}`}>
      <Input
        id={`pricing-${key}`}
        type="number"
        min={min}
        step={1}
        value={str(key)}
        onChange={(e) => set(key, e.target.value === '' ? null : Number(e.target.value))}
      />
    </FormField>
  );
  const isPlan = kind === 'plans';
  async function save(activate: boolean) {
    setBusy(true);
    setError('');
    try {
      const next = await writer.current<PricingRecord>(
        `${base}/${kind}${saved ? '/' + saved.id : ''}`,
        saved ? 'PATCH' : 'POST',
        {
          ...fields,
          currency:
            (kind === 'rules' && fields.mode === 'percentage') ||
            (kind === 'charges' && String(fields.basis).startsWith('percentage'))
              ? null
              : fields.currency,
          ...(saved ? { version: saved.version } : {}),
        },
      );
      setSaved(next);
      onStored();
      const result = activate
        ? await writer.current<PricingRecord>(`${base}/${kind}/${next.id}/activate`, 'POST', {
            version: next.version,
          })
        : next;
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pricing could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle>
            {saved ? 'Edit' : 'Create'}{' '}
            {isPlan ? 'rate plan' : kind === 'rules' ? 'pricing rule' : 'tax or fee'}
          </DialogTitle>
          <DialogDescription>
            Local prices only. Existing bookings and issued quotes keep their original prices. Dates
            use {data.timezone}.
          </DialogDescription>
        </DialogHeader>
        {isPlan ? (
          <TabBar
            label="Rate plan editor steps"
            current={step}
            onSelect={setStep}
            tabs={[
              { id: 'identity', label: 'Identity' },
              { id: 'pricing', label: 'Pricing' },
              { id: 'terms', label: 'Terms' },
              { id: 'scope', label: 'Scope & channels' },
              { id: 'review', label: 'Review' },
            ]}
          />
        ) : null}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {!isPlan || step === 'identity' ? (
              <>
                <FormField label="Name" htmlFor="pricing-name" required>
                  <Input
                    id="pricing-name"
                    value={str('name')}
                    maxLength={200}
                    required
                    onChange={(e) => set('name', e.target.value)}
                  />
                </FormField>
                <FormField label="Description / internal note" htmlFor="pricing-description">
                  <Textarea
                    id="pricing-description"
                    value={str(isPlan ? 'description' : 'note')}
                    onChange={(e) => set(isPlan ? 'description' : 'note', e.target.value)}
                  />
                </FormField>
                {saved?.code ? <Input aria-label="Plan code" value={saved.code} readOnly /> : null}
              </>
            ) : null}
            {!isPlan || step === 'pricing' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {isPlan ? (
                  <>
                    <FormField label="Pricing basis">
                      <Combobox
                        label="Pricing basis"
                        value={str('pricingBasis')}
                        disabled={!!saved}
                        onChange={(v) => set('pricingBasis', v)}
                        options={[
                          { value: 'independent', label: 'Independent nightly prices' },
                          { value: 'derived', label: 'Derived from an independent plan' },
                        ]}
                      />
                    </FormField>
                    <FormField label="Currency" htmlFor="pricing-currency">
                      <Input
                        id="pricing-currency"
                        value={str('currency')}
                        readOnly={!!saved}
                        maxLength={3}
                        onChange={(e) => set('currency', e.target.value.toUpperCase())}
                      />
                    </FormField>
                    {str('pricingBasis') === 'derived' ? (
                      <>
                        <FormField label="Independent parent plan">
                          <Combobox
                            label="Independent parent plan"
                            value={str('basePlanId')}
                            disabled={!!saved}
                            onChange={(v) => set('basePlanId', v)}
                            options={data.plans
                              .filter(
                                (p) =>
                                  p.pricingBasis === 'independent' &&
                                  p.lifecycle !== 'Archived' &&
                                  p.currency === str('currency'),
                              )
                              .map((p) => ({ value: p.id, label: p.name }))}
                          />
                        </FormField>
                        <FormField label="Plan adjustment">
                          <Combobox
                            label="Plan adjustment"
                            value={str('adjustmentKind')}
                            onChange={(v) => set('adjustmentKind', v)}
                            options={[
                              { value: 'percentage', label: 'Percentage increase / decrease' },
                              {
                                value: 'per_person_night',
                                label: 'Fixed amount per person per night',
                              },
                            ]}
                          />
                        </FormField>
                        <FormField label="Adjustment value" htmlFor="pricing-adjustment">
                          <Input
                            id="pricing-adjustment"
                            inputMode="decimal"
                            value={str('adjustmentValue')}
                            onChange={(e) => set('adjustmentValue', e.target.value)}
                          />
                        </FormField>
                      </>
                    ) : (
                      <p className="m-0 text-sm text-muted-foreground">
                        Set nightly amounts in Base prices after saving this draft.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <FormField label={kind === 'rules' ? 'Adjustment' : 'Calculation basis'}>
                      <Combobox
                        label={kind === 'rules' ? 'Adjustment' : 'Calculation basis'}
                        value={str(kind === 'rules' ? 'mode' : 'basis')}
                        onChange={(v) => set(kind === 'rules' ? 'mode' : 'basis', v)}
                        options={
                          kind === 'rules'
                            ? [
                                { value: 'percentage', label: 'Percentage adjustment' },
                                { value: 'fixed', label: 'Fixed amount adjustment' },
                              ]
                            : chargeBases
                        }
                      />
                    </FormField>
                    <FormField
                      label="Value"
                      htmlFor="pricing-value"
                      hint={
                        kind === 'rules'
                          ? 'Use a negative value for a decrease.'
                          : 'No statutory rate is assumed. Enter the confirmed property rate.'
                      }
                    >
                      <Input
                        id="pricing-value"
                        inputMode="decimal"
                        required
                        value={str('value')}
                        onChange={(e) => set('value', e.target.value)}
                      />
                    </FormField>
                    {(kind === 'rules' && str('mode') === 'fixed') ||
                    (kind === 'charges' && !str('basis').startsWith('percentage_')) ? (
                      <FormField
                        label="Currency"
                        htmlFor="pricing-currency"
                        hint="Applies only to plans in this currency; no conversion is performed."
                      >
                        <Input
                          id="pricing-currency"
                          value={str('currency')}
                          maxLength={3}
                          onChange={(e) => set('currency', e.target.value.toUpperCase())}
                        />
                      </FormField>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            {isPlan && step === 'terms' ? (
              <>
                <FormField label="Meal plan">
                  <Combobox
                    label="Meal plan"
                    value={str('mealPlan')}
                    options={mealOptions}
                    onChange={(v) => set('mealPlan', v)}
                  />
                </FormField>
                <Alert>
                  <AlertTitle>Property payment settings apply</AlertTitle>
                  <AlertDescription>
                    Per-plan payment terms are unavailable until checkout can enforce them. This
                    editor does not change payment or cancellation processing.
                  </AlertDescription>
                </Alert>
              </>
            ) : null}
            {!isPlan || step === 'scope' ? (
              <>
                <FormField
                  label="Room types"
                  hint="An empty selection applies to all current and future room types."
                >
                  <MultiSelect
                    label="Pricing room types"
                    value={list('roomTypeIds')}
                    onChange={(v) => set('roomTypeIds', v)}
                    placeholder="All room types"
                    options={data.roomTypes.map((t) => ({ value: t.id, label: t.name }))}
                  />
                </FormField>
                {!isPlan ? (
                  <FormField label="Rate plans" hint="An empty selection applies to all plans.">
                    <MultiSelect
                      label="Pricing rate plans"
                      value={list('ratePlanIds')}
                      onChange={(v) => set('ratePlanIds', v)}
                      placeholder="All rate plans"
                      options={data.plans
                        .filter((p) => p.lifecycle !== 'Archived')
                        .map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </FormField>
                ) : null}
                {isPlan || kind === 'charges' ? (
                  <FormField label="Channels">
                    <MultiSelect
                      label="Pricing channels"
                      value={list('channels')}
                      onChange={(v) => set('channels', v)}
                      options={[
                        { value: 'website', label: 'Website' },
                        { value: 'staff', label: 'Staff' },
                      ]}
                    />
                  </FormField>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label={isPlan ? 'Publication start' : 'Start date'}
                    htmlFor="pricing-start"
                  >
                    <Input
                      id="pricing-start"
                      type="date"
                      value={str(isPlan ? 'publicationStartsOn' : 'startsOn')}
                      onChange={(e) =>
                        set(isPlan ? 'publicationStartsOn' : 'startsOn', e.target.value)
                      }
                    />
                  </FormField>
                  <FormField label="End date (inclusive, optional)" htmlFor="pricing-end">
                    <Input
                      id="pricing-end"
                      type="date"
                      value={str(isPlan ? 'publicationEndsOn' : 'endsOn')}
                      onChange={(e) => set(isPlan ? 'publicationEndsOn' : 'endsOn', e.target.value)}
                    />
                  </FormField>
                </div>
              </>
            ) : null}
            {kind === 'rules' ? (
              <>
                <FormField label="Weekdays">
                  <MultiSelect
                    label="Rule weekdays"
                    value={(fields.weekdays as number[]).map(String)}
                    options={weekdayOptions}
                    onChange={(v) => set('weekdays', v.map(Number))}
                  />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  {numberField('priority', 'Priority (higher wins)', 1)}
                  {numberField('minStay', 'Minimum stay', 1)}
                  {numberField('maxStay', 'Maximum stay', 1)}
                  {numberField('minAdvance', 'Minimum advance days')}
                  {numberField('maxAdvance', 'Maximum advance days')}
                </div>
                <p className="m-0 text-xs text-muted-foreground">
                  Only the highest-priority matching adjustment applies. Equal-priority overlaps
                  cannot activate.
                </p>
              </>
            ) : null}
            {isPlan && step === 'scope' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {numberField('minStay', 'Minimum stay', 1)}
                {numberField('maxStay', 'Maximum stay', 1)}
                {numberField('minAdvance', 'Minimum advance days')}
              </div>
            ) : null}
            {kind === 'charges' ? (
              <>
                <FormField label="Customer display">
                  <Combobox
                    label="Charge display"
                    value={str('display')}
                    onChange={(v) => set('display', v)}
                    options={[
                      { value: 'included', label: 'Included in displayed room price' },
                      { value: 'added', label: 'Added as a separate line' },
                    ]}
                  />
                </FormField>
                <p className="m-0 text-sm text-muted-foreground">
                  Entry is tax-exclusive. All mandatory charges are included once in the customer
                  grand total. Included versus Added changes the disclosure, not the total.
                </p>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="pricing-confirmed"
                    checked={fields.confirmed === true}
                    onCheckedChange={(v) => set('confirmed', v === true)}
                  />
                  <label htmlFor="pricing-confirmed" className="text-sm">
                    I confirm this rate and applicability with the property or accountant.
                  </label>
                </div>
              </>
            ) : null}
            {isPlan && step === 'review' ? (
              <Alert>
                <AlertTitle>{str('name') || 'Unnamed draft'}</AlertTitle>
                <AlertDescription>
                  {str('pricingBasis')} / {str('currency')} / {str('mealPlan')}.{' '}
                  {list('roomTypeIds').length || 'All'} room types. Customer totals include active
                  mandatory charges; the server validates publication. Generated code and pricing
                  basis remain fixed.
                </AlertDescription>
              </Alert>
            ) : null}
            {saved?.lifecycle === 'Active' ? (
              <FormField label="Change reason" htmlFor="pricing-change-reason" required>
                <Textarea
                  id="pricing-change-reason"
                  value={str('changeReason')}
                  onChange={(e) => set('changeReason', e.target.value)}
                />
              </FormField>
            ) : null}
          </fieldset>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Pricing was not published</AlertTitle>
              <AlertDescription>
                {error}
                {saved?.lifecycle === 'Draft' ? ' The saved draft is retained.' : ''}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="outline" type="submit" loading={busy}>
              {saved ? 'Save changes' : 'Save draft'}
            </Button>
            {!saved || saved.lifecycle === 'Draft' ? (
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
