'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

type Unseen = { count: number; ids: string[] };

/**
 * Recent reservations this staff member has not opened yet. They get a dot in the list and add to
 * the count on the Bookings item. Opening one (the preview or the detail page) clears it.
 */
export function useUnseenBookings(
  tenantId: string,
  propertyId: string | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/bookings`;
  const key = ['dashboard', 'unseen-bookings', tenantId, propertyId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Unseen> => {
      const response = await fetch(`${base}/unseen`, { credentials: 'include' });
      if (!response.ok) return { count: 0, ids: [] };
      return (await response.json()) as Unseen;
    },
    enabled: enabled && !!propertyId,
    refetchInterval: 30_000,
  });
  const ids = useMemo(() => new Set(query.data?.ids ?? []), [query.data]);

  const mark = useMutation({
    mutationFn: async (bookingId: string) => {
      await fetch(`${base}/${bookingId}/seen`, { method: 'POST', credentials: 'include' });
    },
    onMutate: (bookingId: string) => {
      queryClient.setQueryData<Unseen>(key, (current) =>
        current && current.ids.includes(bookingId)
          ? {
              count: Math.max(0, current.count - 1),
              ids: current.ids.filter((id) => id !== bookingId),
            }
          : current,
      );
    },
  });

  return {
    count: query.data?.count ?? 0,
    ids,
    /** Marks one reservation as seen; does nothing when it was not new. */
    markSeen: (bookingId: string) => {
      if (ids.has(bookingId)) mark.mutate(bookingId);
    },
  };
}
