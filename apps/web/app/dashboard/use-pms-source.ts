'use client';
import { useQuery } from '@tanstack/react-query';
/** Unknown source fails closed for local stock edits and capacity claims. */
export function usePmsSource(tenantId: string, propertyId: string) {
  return useQuery({
    queryKey: ['dashboard', 'pms-source', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/pms-connection-status`,
        { credentials: 'include' },
      );
      if (!response.ok) throw Error('Hotel inventory source could not be verified.');
      const body = (await response.json()) as { provider?: string };
      if (body.provider !== 'LOCAL' && body.provider !== 'CLOCK_PMS')
        throw Error('Hotel inventory source could not be verified.');
      return body.provider;
    },
    staleTime: 60000,
  });
}
