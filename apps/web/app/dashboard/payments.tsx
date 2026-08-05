'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPropertyBookings, type Reservation } from './reservations';
import { DashboardLoadingSkeleton } from './loading-skeleton';
import styles from './data-table.module.css';
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
  const bookings = bookingsQuery.data ?? [];
  const capabilities = capabilitiesQuery.data ?? [];
  const busyBookingId = actionMutation.isPending ? actionMutation.variables?.bookingId : null;
  const canRefund = capabilities.includes('payments.refund');
  const columns: ColumnDef<Reservation>[] = [
    {
      accessorKey: 'guestEmail',
      header: 'Booking',
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: ({ row }) => `${row.original.total.amount} ${row.original.total.currency}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => paymentStatus(row.original),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const booking = row.original;
        const status = paymentStatus(booking);
        const unpaid = booking.paymentMethod === 'PAY_AT_HOTEL' && status.startsWith('Unpaid');
        return (
          <>
            {unpaid ? (
              <button
                className="must-button must-button--secondary"
                onClick={() =>
                  actionMutation.mutate({
                    bookingId: booking.id,
                    url: `${base}/bookings/${booking.id}/manual-payment`,
                    body: { method: 'cash' },
                    success: 'Payment recorded.',
                  })
                }
                disabled={busyBookingId === booking.id}
              >
                {busyBookingId === booking.id ? <Loader2 aria-hidden="true" size={16} /> : 'Settle'}
              </button>
            ) : null}
            {canRefund ? (
              <button
                className="must-button must-button--danger"
                onClick={() =>
                  actionMutation.mutate({
                    bookingId: booking.id,
                    url: `${base}/payments/refunds`,
                    body: { bookingId: booking.id },
                    success: 'Refund recorded.',
                  })
                }
                disabled={busyBookingId === booking.id}
              >
                {busyBookingId === booking.id ? <Loader2 aria-hidden="true" size={16} /> : 'Refund'}
              </button>
            ) : null}
          </>
        );
      },
    },
  ];
  const table = useReactTable({ data: bookings, columns, getCoreRowModel: getCoreRowModel() });
  if (bookingsQuery.isPending || capabilitiesQuery.isPending)
    return <DashboardLoadingSkeleton label="Loading payments…" />;
  const loadError = bookingsQuery.error ?? capabilitiesQuery.error;
  if (loadError)
    return (
      <div role="alert">
        <Text>{loadError.message}</Text>
        <button
          className="must-button must-button--secondary"
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
  return (
    <Stack gap="lg">
      <header>
        <Heading>Payments</Heading>
        <Text tone="secondary">Booking payment activity for this property.</Text>
      </header>
      <Card>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
