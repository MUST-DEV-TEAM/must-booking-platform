'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

type Property = { id: string; name: string };
type RoomType = { id: string; name: string };
type RatePlan = { id: string; name: string; currency: string; isActive: boolean };
type RateRule = {
  id: string;
  roomTypeId: string;
  startsOn: string | null;
  endsOn: string | null;
  weekdays: number[];
  amount: string;
};
type PropertyRateData = { roomTypes: RoomType[]; ratePlans: RatePlan[] };

const weekdays = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];
const allWeekdays = weekdays.map((day) => day.value);

export function RateManagement({
  tenantId,
  propertyId: selectedPropertyId,
}: {
  tenantId: string;
  propertyId?: string;
}) {
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  const propertiesQuery = useQuery({
    queryKey: ['dashboard', 'properties', tenantId] as const,
    queryFn: async (): Promise<Property[]> => {
      const response = await fetch(`/api/tenants/${tenantId}/properties`, {
        credentials: 'include',
      });
      return response.ok ? ((await response.json()) as Property[]) : [];
    },
  });

  useEffect(() => {
    if (!propertiesQuery.data) return;
    setPropertyId((current) => selectedPropertyId || current || propertiesQuery.data[0]?.id || '');
  }, [propertiesQuery.data, selectedPropertyId]);

  useEffect(() => {
    if (selectedPropertyId) setPropertyId(selectedPropertyId);
  }, [selectedPropertyId]);

  function ratePlansUrl() {
    return `/api/tenants/${tenantId}/properties/${propertyId}/rate-plans`;
  }

  const propertyDataQueryKey = ['dashboard', 'rate-management', tenantId, propertyId] as const;
  const propertyDataQuery = useQuery({
    queryKey: propertyDataQueryKey,
    queryFn: async (): Promise<PropertyRateData> => {
      const [roomTypeResponse, planResponse] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/properties/${propertyId}/room-types`, {
          credentials: 'include',
        }),
        fetch(ratePlansUrl(), { credentials: 'include' }),
      ]);
      if (!roomTypeResponse.ok || !planResponse.ok)
        throw new Error('Unable to load rate plan data.');
      return {
        roomTypes: (await roomTypeResponse.json()) as RoomType[],
        ratePlans: (await planResponse.json()) as RatePlan[],
      };
    },
    enabled: !!propertyId,
  });

  useEffect(() => {
    if (!propertyDataQuery.data) return;
    setSelectedPlanId((current) => current || propertyDataQuery.data.ratePlans[0]?.id || '');
  }, [propertyDataQuery.data]);

  const rulesQueryKey = [
    'dashboard',
    'rate-management',
    'rules',
    tenantId,
    propertyId,
    selectedPlanId,
  ] as const;
  const rulesQuery = useQuery({
    queryKey: rulesQueryKey,
    queryFn: async (): Promise<RateRule[]> => {
      const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}/rules`, {
        credentials: 'include',
      });
      return response.ok ? ((await response.json()) as RateRule[]) : [];
    },
    enabled: !!selectedPlanId,
  });

  const roomTypes = propertyDataQuery.data?.roomTypes ?? [];
  const ratePlans = propertyDataQuery.data?.ratePlans ?? [];
  const rules = rulesQuery.data ?? [];

  const baseRates = useMemo(
    () =>
      new Map(
        rules.filter((rule) => rule.startsOn === null).map((rule) => [rule.roomTypeId, rule]),
      ),
    [rules],
  );
  const calendarDays = useMemo(() => calendarDates(month), [month]);

  const createRatePlanMutation = useMutation({
    mutationFn: async ({
      name,
      currency,
    }: {
      name: FormDataEntryValue | null;
      currency: FormDataEntryValue | null;
      form: HTMLFormElement;
    }) => {
      const response = await fetch(ratePlansUrl(), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, currency, isActive: true }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to create rate plan.'));
    },
    onSuccess: (_result, { form }) => {
      form.reset();
      void queryClient.invalidateQueries({ queryKey: propertyDataQueryKey });
      toast.success('Rate plan created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to create rate plan.'),
  });

  const updateRatePlanMutation = useMutation({
    mutationFn: async ({
      name,
      currency,
      isActive,
    }: {
      name: FormDataEntryValue | null;
      currency: FormDataEntryValue | null;
      isActive: boolean;
    }) => {
      const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, currency, isActive }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update rate plan.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: propertyDataQueryKey });
      toast.success('Rate plan updated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update rate plan.'),
  });

  const deleteRatePlanMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to delete rate plan.'));
    },
    onSuccess: () => {
      setSelectedPlanId('');
      void queryClient.invalidateQueries({ queryKey: propertyDataQueryKey });
      toast.success('Rate plan deleted.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete rate plan.'),
  });

  const createBaseRateMutation = useMutation({
    mutationFn: async ({
      roomTypeId,
      amount,
    }: {
      roomTypeId: FormDataEntryValue | null;
      amount: FormDataEntryValue | null;
      form: HTMLFormElement;
    }) => {
      const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}/rules`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomTypeId,
          startsOn: null,
          endsOn: null,
          weekdays: allWeekdays,
          amount,
        }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to set the base rate.'));
    },
    onSuccess: (_result, { form }) => {
      form.reset();
      void queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      toast.success('Base rate set.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to set the base rate.'),
  });

  const createOverrideMutation = useMutation({
    mutationFn: async ({
      roomTypeId,
      startsOn,
      endsOn,
      selectedWeekdays,
      amount,
    }: {
      roomTypeId: FormDataEntryValue | null;
      startsOn: FormDataEntryValue | null;
      endsOn: FormDataEntryValue | null;
      selectedWeekdays: number[];
      amount: FormDataEntryValue | null;
      form: HTMLFormElement;
    }) => {
      const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}/rules`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomTypeId,
          startsOn,
          endsOn,
          weekdays: selectedWeekdays,
          amount,
        }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to add the date override.'));
    },
    onSuccess: (_result, { form }) => {
      form.reset();
      void queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      toast.success('Calendar override added.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to add the date override.'),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}/rules/${ruleId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to delete the rate rule.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      toast.success('Rate rule deleted.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete the rate rule.'),
  });

  function submitRatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    createRatePlanMutation.mutate({ name: data.get('name'), currency: data.get('currency'), form });
  }

  function submitBaseRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    createBaseRateMutation.mutate({
      roomTypeId: data.get('roomTypeId'),
      amount: data.get('amount'),
      form,
    });
  }

  function updateRatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId) return;
    const form = new FormData(event.currentTarget);
    updateRatePlanMutation.mutate({
      name: form.get('name'),
      currency: form.get('currency'),
      isActive: form.get('isActive') === 'on',
    });
  }

  function deleteRatePlan() {
    if (!selectedPlanId) return;
    deleteRatePlanMutation.mutate();
  }

  function submitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const selectedWeekdays = weekdays
      .filter((day) => data.get(`weekday-${day.value}`) === 'on')
      .map((day) => day.value);
    createOverrideMutation.mutate({
      roomTypeId: data.get('roomTypeId'),
      startsOn: data.get('startsOn'),
      endsOn: data.get('endsOn'),
      selectedWeekdays,
      amount: data.get('amount'),
      form,
    });
  }

  function deleteRule(ruleId: string) {
    if (!selectedPlanId) return;
    deleteRuleMutation.mutate(ruleId);
  }

  return (
    <Stack gap="lg">
      <header>
        <Text tone="secondary">PRICING</Text>
        <Heading>Rate plans and calendar overrides</Heading>
        <Text tone="secondary">
          Set each room type’s all-year base rate, then add seasonal or weekday-specific overrides.
        </Text>
      </header>
      {!selectedPropertyId ? (
        <Card>
          <label className="must-field">
            <span className="must-field__label">Property</span>
            <select
              className="must-input"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              <option value="">Select a property</option>
              {propertiesQuery.data?.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
        </Card>
      ) : null}
      {propertyId ? (
        propertyDataQuery.isPending ? (
          <Card>
            <p>Loading rate plan data…</p>
          </Card>
        ) : propertyDataQuery.isError ? (
          <Card>
            <p>{propertyDataQuery.error.message}</p>
            <button
              className="must-button"
              type="button"
              onClick={() => void propertyDataQuery.refetch()}
            >
              Retry
            </button>
          </Card>
        ) : (
          <Stack gap="lg">
            <Card>
              <Heading level={2}>Add rate plan</Heading>
              <form className="must-stack must-stack--md" onSubmit={submitRatePlan}>
                <label className="must-field">
                  Name
                  <input className="must-input" name="name" required />
                </label>
                <label className="must-field">
                  Currency
                  <input
                    className="must-input"
                    name="currency"
                    required
                    defaultValue="EUR"
                    maxLength={3}
                  />
                </label>
                <button className="must-button must-button--primary">
                  <Plus aria-hidden="true" size={16} /> Add rate plan
                </button>
              </form>
            </Card>
            <Card>
              <label className="must-field">
                <span className="must-field__label">Rate plan</span>
                <select
                  className="must-input"
                  value={selectedPlanId}
                  onChange={(event) => setSelectedPlanId(event.target.value)}
                >
                  <option value="">Select a rate plan</option>
                  {ratePlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({plan.currency}){plan.isActive ? '' : ' — inactive'}
                    </option>
                  ))}
                </select>
              </label>
              {selectedPlanId ? (
                <>
                  <Heading level={2}>Manage selected rate plan</Heading>
                  {ratePlans
                    .filter((plan) => plan.id === selectedPlanId)
                    .map((plan) => (
                      <form
                        className="must-stack must-stack--md"
                        key={plan.id}
                        onSubmit={updateRatePlan}
                      >
                        <label className="must-field">
                          Name
                          <input
                            className="must-input"
                            name="name"
                            required
                            defaultValue={plan.name}
                          />
                        </label>
                        <label className="must-field">
                          Currency
                          <input
                            className="must-input"
                            name="currency"
                            required
                            defaultValue={plan.currency}
                            maxLength={3}
                          />
                        </label>
                        <label className="must-field">
                          <input
                            className="must-input"
                            name="isActive"
                            type="checkbox"
                            defaultChecked={plan.isActive}
                          />
                          Active
                        </label>
                        <button className="must-button must-button--primary">Save rate plan</button>
                        <button
                          className="must-button must-button--danger"
                          type="button"
                          onClick={() => deleteRatePlan()}
                        >
                          Delete rate plan
                        </button>
                      </form>
                    ))}
                  <Heading level={2}>Base rates</Heading>
                  <p>Base rates apply every day unless a dated override matches.</p>
                  <ul>
                    {roomTypes.map((roomType) => (
                      <li key={roomType.id}>
                        {roomType.name}: {baseRates.get(roomType.id)?.amount || 'Not set'}
                        {baseRates.get(roomType.id) ? (
                          <button
                            className="must-button must-button--danger"
                            type="button"
                            onClick={() => deleteRule(baseRates.get(roomType.id)!.id)}
                          >
                            Remove base rate
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <form className="must-stack must-stack--md" onSubmit={submitBaseRate}>
                    <label className="must-field">
                      Room type
                      <select className="must-input" name="roomTypeId" required>
                        <option value="">Select a room type</option>
                        {roomTypes
                          .filter((roomType) => !baseRates.has(roomType.id))
                          .map((roomType) => (
                            <option key={roomType.id} value={roomType.id}>
                              {roomType.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="must-field">
                      Base rate amount
                      <input
                        className="must-input"
                        name="amount"
                        required
                        inputMode="decimal"
                        placeholder="100.00"
                      />
                    </label>
                    <button className="must-button must-button--primary">
                      <Plus aria-hidden="true" size={16} /> Set base rate
                    </button>
                  </form>
                  <Heading level={2}>Add dated override</Heading>
                  <form className="must-stack must-stack--md" onSubmit={submitOverride}>
                    <label className="must-field">
                      Room type
                      <select className="must-input" name="roomTypeId" required>
                        <option value="">Select a room type</option>
                        {roomTypes.map((roomType) => (
                          <option key={roomType.id} value={roomType.id}>
                            {roomType.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="must-field">
                      Starts on
                      <input className="must-input" name="startsOn" required type="date" />
                    </label>
                    <label className="must-field">
                      Ends on
                      <input className="must-input" name="endsOn" required type="date" />
                    </label>
                    <label className="must-field">
                      Override amount
                      <input
                        className="must-input"
                        name="amount"
                        required
                        inputMode="decimal"
                        placeholder="125.00"
                      />
                    </label>
                    <fieldset>
                      <legend>Applies on</legend>
                      {weekdays.map((day) => (
                        <label className="must-field" key={day.value}>
                          <input
                            className="must-input"
                            name={`weekday-${day.value}`}
                            type="checkbox"
                            defaultChecked
                          />
                          {day.label}
                        </label>
                      ))}
                    </fieldset>
                    <button className="must-button must-button--primary">
                      <Plus aria-hidden="true" size={16} /> Add calendar override
                    </button>
                  </form>
                  <Heading level={2}>Override calendar</Heading>
                  <p>
                    <button
                      className="must-button must-button--secondary"
                      type="button"
                      onClick={() => setMonth(addMonths(month, -1))}
                    >
                      Previous month
                    </button>{' '}
                    <strong>
                      {month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                    </strong>{' '}
                    <button
                      className="must-button must-button--secondary"
                      type="button"
                      onClick={() => setMonth(addMonths(month, 1))}
                    >
                      Next month
                    </button>
                  </p>
                  <table>
                    <caption>Dated overrides by day</caption>
                    <thead>
                      <tr>
                        {weekdays.map((day) => (
                          <th key={day.value}>{day.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {calendarWeeks(calendarDays).map((week, index) => (
                        <tr key={index}>
                          {week.map((date, dayIndex) => (
                            <td key={date?.toISOString() || `blank-${index}-${dayIndex}`}>
                              {date ? (
                                <CalendarCell date={date} rules={rules} roomTypes={roomTypes} />
                              ) : null}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Heading level={3}>Dated overrides</Heading>
                  <ul>
                    {rules
                      .filter((rule) => rule.startsOn !== null)
                      .map((rule) => (
                        <li key={rule.id}>
                          {roomTypes.find((roomType) => roomType.id === rule.roomTypeId)?.name ||
                            'Room type'}
                          : {rule.amount} from {dateOnly(rule.startsOn)} to {dateOnly(rule.endsOn)}{' '}
                          ({rule.weekdays.map((day) => weekdays[day].label).join(', ')})
                          <button
                            className="must-button must-button--danger"
                            type="button"
                            onClick={() => deleteRule(rule.id)}
                          >
                            Remove override
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : (
                <p>Create or select a rate plan to set rates.</p>
              )}
            </Card>
          </Stack>
        )
      ) : null}
    </Stack>
  );
}

function CalendarCell({
  date,
  rules,
  roomTypes,
}: {
  date: Date;
  rules: RateRule[];
  roomTypes: RoomType[];
}) {
  const dateValue = date.toISOString().slice(0, 10);
  const matchingRules = rules.filter(
    (rule) =>
      rule.startsOn !== null &&
      dateValue >= dateOnly(rule.startsOn) &&
      dateValue <= dateOnly(rule.endsOn) &&
      rule.weekdays.includes(date.getDay()),
  );
  return (
    <>
      <strong>{date.getDate()}</strong>
      <ul>
        {matchingRules.map((rule) => (
          <li key={rule.id}>
            {roomTypes.find((roomType) => roomType.id === rule.roomTypeId)?.name || 'Room'}:{' '}
            {rule.amount}
          </li>
        ))}
      </ul>
    </>
  );
}

function calendarDates(month: Date): Array<Date | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const dates: Array<Date | null> = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= last.getDate(); day += 1)
    dates.push(new Date(month.getFullYear(), month.getMonth(), day));
  while (dates.length % 7 !== 0) dates.push(null);
  return dates;
}

function calendarWeeks<T>(items: T[]): T[][] {
  return Array.from({ length: items.length / 7 }, (_, index) =>
    items.slice(index * 7, index * 7 + 7),
  );
}

function addMonths(month: Date, offset: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + offset, 1);
}

function dateOnly(date: string | null): string {
  return date?.slice(0, 10) || '';
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}
