'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import styles from './walk-in-booking.module.css';

type Room = { id: string; name: string };
type Rate = { id: string; name: string; currency: string };
type Quote = { total: { amount: string; currency: string } };
type StayInput = { roomTypeId: string; ratePlanId: string; startsOn: string; endsOn: string };
type Guest = { firstName: string; lastName: string; email: string; phone: string };
type PaymentMethod = 'cash' | 'card_in_person' | 'bank_transfer' | '';
const key = () => crypto.randomUUID();

export function WalkInBooking({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [roomTypeId, setRoom] = useState('');
  const [ratePlanId, setRate] = useState('');
  const [startsOn, setStart] = useState('');
  const [endsOn, setEnd] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [guest, setGuest] = useState<Guest>({ firstName: '', lastName: '', email: '', phone: '' });
  const [method, setMethod] = useState<PaymentMethod>('');
  const catalogQuery = useQuery({
    queryKey: ['dashboard', 'walk-in-booking-catalog', tenantId, propertyId],
    queryFn: async () => {
      const [roomsResponse, ratesResponse] = await Promise.all([
        fetch(`${base}/room-types`, { credentials: 'include' }),
        fetch(`${base}/rate-plans`, { credentials: 'include' }),
      ]);
      if (!roomsResponse.ok || !ratesResponse.ok)
        throw new Error('Unable to load rooms and rates.');
      const [rooms, rates] = (await Promise.all([roomsResponse.json(), ratesResponse.json()])) as [
        Room[],
        Rate[],
      ];
      return { rooms, rates };
    },
  });
  const availabilityMutation = useMutation({
    mutationFn: async (input: StayInput) => {
      const [price, availability] = await Promise.all([
        post(`${base}/quotes`, input),
        fetch(`${base}/availability?${new URLSearchParams(input)}`, {
          credentials: 'include',
        }).then(json),
      ]);
      if (!availability.isAvailable)
        throw new Error('No rooms are available for the selected stay.');
      return price as Quote;
    },
    onMutate: () => setQuote(null),
    onSuccess: (nextQuote) => setQuote(nextQuote),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const bookingMutation = useMutation({
    mutationFn: async ({
      input,
      guest,
      method,
    }: {
      input: StayInput;
      guest: Guest;
      method: PaymentMethod;
    }) => {
      const result = await post(`${base}/staff-bookings`, { ...input, guest }, key());
      if (!result.ok) throw new Error(result.error?.message ?? 'Unable to create booking.');
      if (method) {
        const paid = await post(
          `${base}/bookings/${result.value.id}/manual-payment`,
          { method },
          key(),
        );
        if (!paid.ok)
          throw new Error(
            paid.error?.message ?? 'Booking created, but payment could not be recorded.',
          );
      }
      return method;
    },
    onSuccess: (paymentMethod) => {
      toast.success(
        paymentMethod
          ? 'Booking created and payment recorded.'
          : 'Booking created as pay at hotel.',
      );
      setQuote(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  useEffect(() => {
    if (catalogQuery.isError) toast.error(errorMessage(catalogQuery.error));
  }, [catalogQuery.error, catalogQuery.isError]);
  const rooms = catalogQuery.data?.rooms ?? [];
  const rates = catalogQuery.data?.rates ?? [];
  const busy = availabilityMutation.isPending || bookingMutation.isPending;
  const input = { roomTypeId, ratePlanId, startsOn, endsOn };
  return (
    <Stack className={styles.page} gap="lg">
      <header>
        <Text tone="secondary">FRONT DESK</Text>
        <Heading>New walk-in booking</Heading>
        <Text tone="secondary">
          Search availability, confirm the stay, then optionally settle it at the desk.
        </Text>
      </header>
      <Card>
        <div className={styles.grid}>
          <label>
            Room type
            <select value={roomTypeId} onChange={(e) => setRoom(e.target.value)}>
              <option value="">Select room</option>
              {rooms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rate plan
            <select value={ratePlanId} onChange={(e) => setRate(e.target.value)}>
              <option value="">Select rate</option>
              {rates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Check-in
            <input type="date" value={startsOn} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Check-out
            <input type="date" value={endsOn} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !roomTypeId || !ratePlanId || !startsOn || !endsOn}
          onClick={() => availabilityMutation.mutate(input)}
        >
          Search availability
        </button>
        {quote ? (
          <>
            <Text className={styles.total}>
              Total: {quote.total.amount} {quote.total.currency}
            </Text>
            <div className={styles.grid}>
              <label>
                First name
                <input
                  value={guest.firstName}
                  onChange={(e) => setGuest({ ...guest, firstName: e.target.value })}
                />
              </label>
              <label>
                Last name
                <input
                  value={guest.lastName}
                  onChange={(e) => setGuest({ ...guest, lastName: e.target.value })}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={guest.email}
                  onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                />
              </label>
              <label>
                Phone
                <input
                  value={guest.phone}
                  onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                />
              </label>
              <label>
                Settle now
                <select
                  aria-label="Payment method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                >
                  <option value="">Pay at hotel later</option>
                  <option value="cash">Cash</option>
                  <option value="card_in_person">Card in person</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={busy || !guest.email}
              onClick={() => bookingMutation.mutate({ input, guest, method })}
            >
              Create booking
            </button>
          </>
        ) : null}
      </Card>
    </Stack>
  );
}
async function json(response: Response) {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
async function post(url: string, body: unknown, idempotencyKey?: string) {
  return json(
    await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : 'Request failed.';
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    return Array.isArray(parsed.message) ? parsed.message.join(' ') : (parsed.message ?? raw);
  } catch {
    return raw;
  }
}
