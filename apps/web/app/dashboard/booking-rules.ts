'use client';

import { useQuery } from '@tanstack/react-query';

export type BookingRulesEvaluation = {
  today: string;
  minStayNights: number | null;
  maxStayNights: number | null;
  disabledDates: string[];
  pastDateMessage?: string;
  booking: { valid: boolean; errors: Array<{ code: string; message: string }> };
  block: { valid: boolean; errors: Array<{ code: string; message: string }> };
};

/** Fetches server-evaluated rules; no booking policy is implemented in the browser. */
export function useBookingRulesEvaluation(
  tenantId: string,
  propertyId: string,
  input: Record<string, string | number | undefined> = {},
  enabled = true,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return useQuery({
    queryKey: ['dashboard', 'booking-rules', tenantId, propertyId, params.toString()],
    enabled: enabled && Boolean(propertyId),
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/booking-rules/evaluate?${params}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Booking rules could not be verified.');
      const result = (await response.json()) as BookingRulesEvaluation;
      if (
        typeof result.today !== 'string' ||
        !Array.isArray(result.disabledDates) ||
        !result.booking ||
        !result.block
      )
        throw new Error('Booking rules could not be verified.');
      return result;
    },
  });
}
