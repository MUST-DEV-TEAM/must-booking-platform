'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PricingSection } from '../pricing';
import { inventoryRequest } from '../inventory-api';
import { Combobox } from '../../../components/ui/combobox';
import { FormField } from '../../../components/ui/form-field';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../../components/ui/state-panel';
export function RateManagement({
  tenantId,
  propertyId,
  emailVerified = false,
}: {
  tenantId: string;
  propertyId?: string;
  emailVerified?: boolean;
}) {
  const [chosen, setChosen] = useState('');
  const properties = useQuery({
    queryKey: ['dashboard', 'properties', tenantId],
    enabled: !propertyId,
    queryFn: () =>
      inventoryRequest<{ id: string; name: string }[]>(`/api/tenants/${tenantId}/properties`),
  });
  if (!propertyId && properties.isPending) return <ListSkeleton />;
  if (!propertyId && properties.error)
    return (
      <ErrorPanel title="Hotels could not be loaded" onRetry={() => void properties.refetch()} />
    );
  const selected = propertyId || chosen || properties.data?.[0]?.id;
  if (!selected) return <EmptyPanel title="Choose a hotel to manage rates" />;
  return (
    <div className="flex flex-col gap-5">
      {!propertyId ? (
        <FormField label="Hotel">
          <Combobox
            label="Hotel"
            value={selected}
            onChange={setChosen}
            options={(properties.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />
        </FormField>
      ) : null}
      <PricingSection
        key={selected}
        tenantId={tenantId}
        propertyId={selected}
        emailVerified={emailVerified}
      />
    </div>
  );
}
