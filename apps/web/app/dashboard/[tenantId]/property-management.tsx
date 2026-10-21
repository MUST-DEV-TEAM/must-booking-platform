'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HotelCreateDialog } from '../../../components/ui/hotel-create-dialog';
/** Existing property-create endpoint and plan-cap flow, composed with the shared dialog. */
export function PropertyManagement({
  tenantId,
  onClose,
}: {
  tenantId: string;
  onClose: () => void;
}) {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [capReached, setCapReached] = useState(false);
  const query = useQuery({
    queryKey: ['dashboard', 'hotel-create-plan', tenantId],
    queryFn: async () => {
      const r = await fetch(`/api/tenants/${tenantId}/plan-usage`, { credentials: 'include' });
      if (!r.ok) throw new Error('Could not check your plan. Try again.');
      return r.json() as Promise<{
        plan: { maxProperties: number };
        usage: { properties: number };
      }>;
    },
  });
  return (
    <HotelCreateDialog
      open
      onClose={onClose}
      busy={busy}
      loading={query.isPending}
      unavailable={query.isError}
      onRetry={() => void query.refetch()}
      error={error || (query.isError ? query.error.message : undefined)}
      atCap={
        capReached || (!!query.data && query.data.usage.properties >= query.data.plan.maxProperties)
      }
      onSubmit={async (data) => {
        setBusy(true);
        setError('');
        try {
          const r = await fetch(`/api/tenants/${tenantId}/properties`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (r.status === 409) {
            setCapReached(true);
            return;
          }
          if (!r.ok) throw new Error('Unable to create hotel. Check your access and try again.');
          await client.invalidateQueries({ queryKey: ['dashboard'] });
          toast.success('Hotel created.');
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Unable to create hotel.');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
