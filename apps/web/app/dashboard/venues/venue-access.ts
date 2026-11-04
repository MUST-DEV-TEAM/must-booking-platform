'use client';
import { useQuery } from '@tanstack/react-query';
import { venueApi } from './venue-api';

/** A successful scoped staff read grants restaurant staff management; waiters receive 403. */
export function useVenueStaff(tenantId: string, venueId: string) {
  return useQuery({
    queryKey: ['venue-staff', tenantId, venueId],
    queryFn: () => venueApi.listStaff(tenantId, venueId),
    retry: false,
  });
}

export function useRestaurantStaffAccess(
  tenantId: string,
  propertyId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['restaurant-staff-access', tenantId, propertyId],
    enabled,
    retry: false,
    queryFn: async () => {
      const venues = await venueApi.listVenues(tenantId);
      const results = await Promise.all(
        venues
          .filter((v) => v.active && (!v.propertyId || v.propertyId === propertyId))
          .map(async (v) => {
            try {
              await venueApi.listStaff(tenantId, v.id);
              return true;
            } catch {
              return false;
            }
          }),
      );
      return results.some(Boolean);
    },
  });
}
