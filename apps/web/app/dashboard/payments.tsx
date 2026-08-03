'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPropertyBookings, type Reservation } from './reservations';
import { DashboardLoadingSkeleton } from './loading-skeleton';
const id = () => crypto.randomUUID();
export function DashboardPayments({
  tenantId,
  propertyId,
  initialBookings,
  initialCapabilities,
}: {
  tenantId: string;
  propertyId: string;
  initialBookings?: Reservation[];
  initialCapabilities?: string[];
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [bookings, setBookings] = useState<Reservation[] | undefined>(initialBookings);
  const [capabilities, setCapabilities] = useState<string[] | undefined>(initialCapabilities);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  useEffect(() => {
    if (!initialBookings) void fetchPropertyBookings(tenantId, propertyId).then(setBookings);
  }, [initialBookings, tenantId, propertyId]);
  useEffect(() => {
    if (!initialCapabilities)
      void fetch(`${base}/capabilities/mine`, { credentials: 'include' })
        .then((r) => r.json())
        .then(setCapabilities);
  }, [base, initialCapabilities]);
  async function action(bookingId: string, url: string, body: unknown, success: string) {
    setBusyBookingId(bookingId);
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id() },
      body: JSON.stringify(body),
    });
    const v = await r.json();
    if (v.ok) {
      void fetchPropertyBookings(tenantId, propertyId).then(setBookings);
      toast.success(success);
    } else toast.error(v.error?.message ?? 'Payment action failed.');
    setBusyBookingId(null);
  }
  if (!bookings || !capabilities) return <DashboardLoadingSkeleton label="Loading payments…" />;
  const canRefund = capabilities.includes('payments.refund');
  return (
    <Stack gap="lg">
      <header>
        <Heading>Payments</Heading>
        <Text tone="secondary">Booking payment activity for this property.</Text>
      </header>
      <Card>
        <table>
          <thead>
            <tr>
              <th>Booking</th>
              <th>Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const status = paymentStatus(b);
              const unpaid = b.paymentMethod === 'PAY_AT_HOTEL' && status.startsWith('Unpaid');
              return (
                <tr key={b.id}>
                  <td>{b.guestEmail}</td>
                  <td>
                    {b.total.amount} {b.total.currency}
                  </td>
                  <td>{status}</td>
                  <td>
                    {unpaid ? (
                      <button
                        onClick={() =>
                          action(
                            b.id,
                            `${base}/bookings/${b.id}/manual-payment`,
                            { method: 'cash' },
                            'Payment recorded.',
                          )
                        }
                        disabled={busyBookingId === b.id}
                      >
                        {busyBookingId === b.id ? (
                          <Loader2 aria-hidden="true" size={16} />
                        ) : (
                          'Settle'
                        )}
                      </button>
                    ) : null}
                    {canRefund ? (
                      <button
                        onClick={() =>
                          action(
                            b.id,
                            `${base}/payments/refunds`,
                            { bookingId: b.id },
                            'Refund recorded.',
                          )
                        }
                        disabled={busyBookingId === b.id}
                      >
                        {busyBookingId === b.id ? (
                          <Loader2 aria-hidden="true" size={16} />
                        ) : (
                          'Refund'
                        )}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </Stack>
  );
}
function paymentStatus(b: Reservation) {
  if (Number(b.refundedAmount) > 0) return 'Refunded';
  if (Number(b.paidAmount) >= Number(b.total.amount)) return 'Paid';
  if (Number(b.paidAmount) > 0) return 'Partially paid';
  return b.paymentMethod === 'PAY_AT_HOTEL' ? 'Unpaid — pay at hotel' : 'Payment pending';
}
