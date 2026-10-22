'use client';
import { useClockSnapshot } from './clock-sync';
import { StatTile } from '../../components/ui/stat-tile';
export function useClockRoomCounts(tenantId: string, propertyId: string, enabled: boolean) {
  const snapshot = useClockSnapshot<{
    configuredRooms: number;
    byRoomType: Record<string, number>;
    readAt: string;
  }>(tenantId, propertyId, 'rooms', enabled);
  return { ...snapshot, data: snapshot.data?.data ?? undefined };
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
        counts.data?.configuredRooms ?? (counts.isFetching ? 'Synchronizing...' : 'Unavailable')
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
