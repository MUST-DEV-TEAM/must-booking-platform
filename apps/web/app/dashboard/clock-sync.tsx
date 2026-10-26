'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePmsSource } from './use-pms-source';
import { ClockSyncProgress, type SyncSummary } from './clock-sync-progress';
export type ClockDay = {
  date: string;
  status: string;
  availableUnits?: number;
  referencePrice?: { amount: string; currency: string };
  minStay?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
};
export type ClockMonth = { roomTypes: Array<{ id: string; name: string; days: ClockDay[] }> };
export type Snapshot<T> = {
  data: T | null;
  status: string;
  lastSyncedAt: string | null;
  lastError?: string | null;
};
export function useClockSnapshot<T>(
  tenantId: string,
  propertyId: string,
  resource: string,
  enabled = true,
) {
  const path = resource.startsWith('availability:')
    ? 'availability?month=' + encodeURIComponent(resource.slice(13))
    : resource;
  return useQuery({
    queryKey: ['dashboard', 'clock-sync-snapshot', tenantId, propertyId, resource],
    enabled,
    queryFn: async () => {
      const r = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/clock-sync/${path}`,
        { credentials: 'include' },
      );
      if (!r.ok) throw Error('Synchronized Clock information could not be read.');
      return (await r.json()) as Snapshot<T>;
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });
}
export function availableOn(
  snapshot: ClockMonth | null | undefined,
  date: string,
): number | undefined {
  if (!snapshot?.roomTypes.length) return undefined;
  let total = 0;
  for (const type of snapshot.roomTypes) {
    const day = type.days.find((d) => d.date === date);
    if (!day || day.status === 'unavailable' || day.availableUnits === undefined) return undefined;
    total += day.status === 'available' ? day.availableUnits : 0;
  }
  return total;
}
export type SyncStatusData = Partial<SyncSummary> & {
  enabled: boolean;
  jobs: Array<{
    resource: string;
    status: string;
    processed: number;
    total: number | null;
    lastSyncedAt: string | null;
    lastError: string | null;
  }>;
};

/** The synchronization status of a Clock hotel, shared by every screen that shows it. */
export function useClockSyncStatus(tenantId: string, propertyId: string, enabled: boolean) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/clock-sync`;
  return useQuery({
    queryKey: ['dashboard', 'clock-sync-status', tenantId, propertyId],
    enabled,
    queryFn: async () => {
      const r = await fetch(base + '/status', { credentials: 'include' });
      if (!r.ok) throw Error('Clock synchronization status could not be read.');
      return (await r.json()) as SyncStatusData;
    },
    refetchInterval: 10000,
  });
}

/** Asks for a fresh read from Clock now, ahead of the regular background schedule. */
export function useClockSyncNow(tenantId: string, propertyId: string) {
  const client = useQueryClient();
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/clock-sync`;
  return useMutation({
    mutationFn: async () => {
      const r = await fetch(base + '/refresh', { method: 'POST', credentials: 'include' });
      if (!r.ok) throw Error('Synchronization could not be queued.');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['dashboard'] }),
  });
}

/** When Clock data was last brought in: the newest finish among the parts of the synchronization. */
export function lastSyncedAt(data: SyncStatusData | undefined): string | null {
  const times = (data?.groups ?? [])
    .flatMap((g) => (g.lastSyncedAt ? [g.lastSyncedAt] : []))
    .sort();
  return times.at(-1) ?? null;
}

export function ClockSyncStatus({
  tenantId,
  propertyId,
  details = false,
  inventoryOnly = false,
}: {
  tenantId: string;
  propertyId: string;
  details?: boolean;
  inventoryOnly?: boolean;
}) {
  const source = usePmsSource(tenantId, propertyId);
  const status = useClockSyncStatus(tenantId, propertyId, source.data === 'CLOCK_PMS');
  const recover = useClockSyncNow(tenantId, propertyId);
  if (source.data !== 'CLOCK_PMS') return null;
  const jobs = (status.data?.jobs ?? []).filter(
    (job) =>
      !inventoryOnly ||
      job.resource === 'catalog' ||
      job.resource === 'rooms' ||
      job.resource === 'rates' ||
      job.resource.startsWith('availability:'),
  );
  const failed = jobs.filter((j) => j.status === 'FAILED');
  const pending = jobs.some(
    (j) => !j.lastSyncedAt || ['RUNNING', 'READY', 'RETRY'].includes(j.status),
  );
  const latest = jobs
    .flatMap((j) => (j.lastSyncedAt ? [j.lastSyncedAt] : []))
    .sort()
    .at(-1);
  return (
    <div className="space-y-2 rounded-lg border px-3 py-2 text-sm" role="status">
      <p className="m-0">
        {failed.length
          ? 'Clock synchronization needs attention'
          : status.data?.enabled === false
            ? 'Automatic Clock synchronization is paused'
            : pending
              ? 'Clock data is updating automatically'
              : 'Clock data is synchronized'}
        {latest ? ` · Last update ${new Date(latest).toLocaleString()}` : ''}
      </p>
      {status.error ? <p>{status.error.message}</p> : null}
      {details && status.data?.groups && status.data.overall ? (
        <ClockSyncProgress
          summary={{ groups: status.data.groups, overall: status.data.overall }}
          enabled={status.data.enabled}
          syncing={recover.isPending}
          syncError={recover.error?.message ?? null}
          onSyncNow={() => recover.mutate()}
        />
      ) : null}
    </div>
  );
}
