'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useEffect, useState } from 'react';

import { DashboardShell } from './dashboard-shell';

type Property = { id: string; name: string };

export function PropertyEntry({ tenantId }: { tenantId: string }) {
  const [properties, setProperties] = useState<Property[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' })
      .then(async (response) => (response.ok ? ((await response.json()) as Property[]) : []))
      .then((value) => {
        if (active) setProperties(value);
      })
      .catch(() => {
        if (active) setProperties([]);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  if (properties === null) return <Text>Loading properties…</Text>;
  if (properties.length === 0) return <Text>No properties are available for this workspace.</Text>;

  const requestedPropertyId = new URLSearchParams(window.location.search).get('propertyId');
  if (
    properties.length === 1 ||
    properties.some((property) => property.id === requestedPropertyId)
  ) {
    return <DashboardShell tenantId={tenantId} />;
  }

  return (
    <main>
      <Card>
        <Stack gap="lg">
          <header>
            <Heading>Choose a property</Heading>
            <Text tone="secondary">Select the hotel you want to manage.</Text>
          </header>
          <ul>
            {properties.map((property) => (
              <li key={property.id}>
                <a
                  href={`/dashboard/${tenantId}?propertyId=${encodeURIComponent(property.id)}&section=overview`}
                >
                  {property.name}
                </a>
              </li>
            ))}
          </ul>
        </Stack>
      </Card>
    </main>
  );
}
