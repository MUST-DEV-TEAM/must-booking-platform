'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { FormEvent, useEffect, useMemo, useState } from 'react';

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
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [propertyId, setPropertyId] = useState('');
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [rules, setRules] = useState<RateRule[]>([]);
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    void fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' })
      .then(async (response) => (response.ok ? ((await response.json()) as Property[]) : []))
      .then((items) => {
        setProperties(items);
        setPropertyId((current) => selectedPropertyId || current || items[0]?.id || '');
      })
      .catch(() => setProperties([]));
  }, [selectedPropertyId, tenantId]);

  useEffect(() => {
    if (selectedPropertyId) setPropertyId(selectedPropertyId);
  }, [selectedPropertyId]);

  useEffect(() => {
    if (!propertyId) return;
    void loadPropertyData();
  }, [propertyId]);

  useEffect(() => {
    if (!selectedPlanId) {
      setRules([]);
      return;
    }
    void loadRules(selectedPlanId);
  }, [selectedPlanId]);

  const baseRates = useMemo(
    () =>
      new Map(
        rules.filter((rule) => rule.startsOn === null).map((rule) => [rule.roomTypeId, rule]),
      ),
    [rules],
  );
  const calendarDays = useMemo(() => calendarDates(month), [month]);

  async function loadPropertyData() {
    const [roomTypeResponse, planResponse] = await Promise.all([
      fetch(`/api/tenants/${tenantId}/properties/${propertyId}/room-types`, {
        credentials: 'include',
      }),
      fetch(ratePlansUrl(), { credentials: 'include' }),
    ]);
    if (roomTypeResponse.ok) setRoomTypes((await roomTypeResponse.json()) as RoomType[]);
    if (planResponse.ok) {
      const plans = (await planResponse.json()) as RatePlan[];
      setRatePlans(plans);
      setSelectedPlanId((current) => current || plans[0]?.id || '');
    }
  }

  async function loadRules(ratePlanId: string) {
    const response = await fetch(`${ratePlansUrl()}/${ratePlanId}/rules`, {
      credentials: 'include',
    });
    if (response.ok) setRules((await response.json()) as RateRule[]);
  }

  async function submitRatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch(ratePlansUrl(), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: data.get('name'),
        currency: data.get('currency'),
        isActive: true,
      }),
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to create rate plan.'));
      return;
    }
    form.reset();
    await loadPropertyData();
  }

  async function submitBaseRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId) return;
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}/rules`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roomTypeId: data.get('roomTypeId'),
        startsOn: null,
        endsOn: null,
        weekdays: allWeekdays,
        amount: data.get('amount'),
      }),
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to set the base rate.'));
      return;
    }
    form.reset();
    await loadRules(selectedPlanId);
  }

  async function updateRatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId) return;
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        currency: form.get('currency'),
        isActive: form.get('isActive') === 'on',
      }),
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to update rate plan.'));
      return;
    }
    await loadPropertyData();
  }

  async function deleteRatePlan() {
    if (!selectedPlanId) return;
    setMessage('');
    const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to delete rate plan.'));
      return;
    }
    setSelectedPlanId('');
    setRules([]);
    await loadPropertyData();
  }

  async function submitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId) return;
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const selectedWeekdays = weekdays
      .filter((day) => data.get(`weekday-${day.value}`) === 'on')
      .map((day) => day.value);
    const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}/rules`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roomTypeId: data.get('roomTypeId'),
        startsOn: data.get('startsOn'),
        endsOn: data.get('endsOn'),
        weekdays: selectedWeekdays,
        amount: data.get('amount'),
      }),
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to add the date override.'));
      return;
    }
    form.reset();
    await loadRules(selectedPlanId);
  }

  async function deleteRule(ruleId: string) {
    if (!selectedPlanId) return;
    setMessage('');
    const response = await fetch(`${ratePlansUrl()}/${selectedPlanId}/rules/${ruleId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to delete the rate rule.'));
      return;
    }
    await loadRules(selectedPlanId);
  }

  function ratePlansUrl() {
    return `/api/tenants/${tenantId}/properties/${propertyId}/rate-plans`;
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
              {properties?.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
        </Card>
      ) : null}
      {propertyId ? (
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
              <button className="must-button must-button--primary">Add rate plan</button>
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
                        onClick={() => void deleteRatePlan()}
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
                          onClick={() => void deleteRule(baseRates.get(roomType.id)!.id)}
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
                  <button className="must-button must-button--primary">Set base rate</button>
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
                    Add calendar override
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
                        : {rule.amount} from {dateOnly(rule.startsOn)} to {dateOnly(rule.endsOn)} (
                        {rule.weekdays.map((day) => weekdays[day].label).join(', ')})
                        <button
                          className="must-button must-button--danger"
                          type="button"
                          onClick={() => void deleteRule(rule.id)}
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
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
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
