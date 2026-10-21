'use client';
import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/ui/stat-tile';
export function useClockRoomCounts(tenantId: string, propertyId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'clock-room-counts', tenantId, propertyId],
    enabled,
    queryFn: async () => {
      const r = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/clock-catalog/room-counts`,
        { credentials: 'include' },
      );
      if (!r.ok) throw Error('Clock room counts could not be read.');
      return (await r.json()) as {
        configuredRooms: number;
        byRoomType: Record<string, number>;
        readAt: string;
      };
    },
    staleTime: 1200000,
    refetchOnWindowFocus: false,
  });
}
export function ClockRoomsTile({
  tenantId,
  propertyId,
  canOpenCalendar = false,
}: {
  tenantId: string;
  propertyId: string;
  canOpenCalendar?: boolean;
}) {
  const counts = useClockRoomCounts(tenantId, propertyId, true);
  return (
    <StatTile
      label="Rooms in Clock"
      value={
        counts.data?.configuredRooms ?? (counts.isFetching ? 'Reading Clock...' : 'Unavailable')
      }
      note="Configured rooms from Clock; occupancy is managed in Clock."
      href={
        canOpenCalendar
          ? `/dashboard/${tenantId}?propertyId=${propertyId}&section=calendar`
          : undefined
      }
    />
  );
}
