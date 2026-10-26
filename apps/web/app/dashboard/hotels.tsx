'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HotelDirectory, type DirectoryHotel } from '../../components/ui/hotel-directory';
import { PropertyManagement } from './[tenantId]/property-management';
export function HotelsSection({
  tenantId,
  role,
  emailVerified,
}: {
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
  emailVerified: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['dashboard', 'hotels-directory', tenantId],
    queryFn: async () => {
      const r = await fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' });
      if (!r.ok) throw new Error('Unable to load your hotels.');
      return (await r.json()) as DirectoryHotel[];
    },
  });
  const canAdmin = role === 'OWNER' || role === 'ADMIN';
  return (
    <HotelDirectory
      tenantId={tenantId}
      hotels={query.data ?? []}
      loading={query.isPending}
      error={query.isError ? query.error.message : undefined}
      onRetry={() => void query.refetch()}
      canCreate={canAdmin && emailVerified}
      canOpenSettings={canAdmin}
      onCreate={() => setCreating(true)}
      createDialog={
        canAdmin && emailVerified && creating ? (
          <PropertyManagement tenantId={tenantId} onClose={() => setCreating(false)} />
        ) : null
      }
    />
  );
}
