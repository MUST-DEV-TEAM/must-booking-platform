'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
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
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'payments-bookings', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
    initialData: initialBookings,
    staleTime: initialBookings ? Infinity : 0,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['dashboard', 'payment-capabilities', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/capabilities/mine`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load payment permissions.');
      return (await response.json()) as string[];
    },
    initialData: initialCapabilities,
    staleTime: initialCapabilities ? Infinity : 0,
  });
  const actionMutation = useMutation({
    mutationFn: async ({
      bookingId,
      url,
      body,
      success,
    }: {
      bookingId: string;
      url: string;
      body: unknown;
      success: string;
    }) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id() },
        body: JSON.stringify(body),
      });
      const value = (await response.json()) as { ok: boolean; error?: { message?: string } };
      if (!value.ok) throw new Error(value.error?.message ?? 'Payment action failed.');
      return { bookingId, success };
    },
    onSuccess: ({ success }) => {
      void bookingsQuery.refetch();
      toast.success(success);
    },
    onError: (error) => toast.error(error.message),
  });
  if (bookingsQuery.isPending || capabilitiesQuery.isPending)
    return <DashboardLoadingSkeleton label="Loading payments…" />;
  const loadError = bookingsQuery.error ?? capabilitiesQuery.error;
  if (loadError)
    return (
      <div role="alert">
        <Text>{loadError.message}</Text>
        <button
          onClick={() => {
            void bookingsQuery.refetch();
            void capabilitiesQuery.refetch();
          }}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  const bookings = bookingsQuery.data ?? [];
  const capabilities = capabilitiesQuery.data ?? [];
  const busyBookingId = actionMutation.isPending ? actionMutation.variables?.bookingId : null;
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
                          actionMutation.mutate({
                            bookingId: b.id,
                            url: `${base}/bookings/${b.id}/manual-payment`,
                            body: { method: 'cash' },
                            success: 'Payment recorded.',
                          })
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
                          actionMutation.mutate({
                            bookingId: b.id,
                            url: `${base}/payments/refunds`,
                            body: { bookingId: b.id },
                            success: 'Refund recorded.',
                          })
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
