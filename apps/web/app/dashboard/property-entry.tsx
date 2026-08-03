'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useEffect, useState } from 'react';

import { DashboardShell } from './dashboard-shell';
import styles from './selection.module.css';

type Property = { id: string; name: string };

export function PropertyEntry({ tenantId }: { tenantId: string }) {
  const [properties, setProperties] = useState<Property[] | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' })
      .then(async (response) => (response.ok ? ((await response.json()) as Property[]) : []))
      .then((value) => active && setProperties(value))
      .catch(() => active && setProperties([]));
    return () => {
      active = false;
    };
  }, [tenantId]);
  if (properties === null)
    return (
      <main className={styles.page}>
        <Text>Loading properties…</Text>
      </main>
    );
  if (properties.length === 0)
    return (
      <main className={styles.page}>
        <Text>No properties are available for this workspace.</Text>
      </main>
    );
  const requested = new URLSearchParams(window.location.search).get('propertyId');
  if (properties.length === 1 || properties.some((property) => property.id === requested))
    return <DashboardShell tenantId={tenantId} />;
  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <Stack gap="lg">
          <header>
            <p className={styles.eyebrow}>MUST BOOKING</p>
            <Heading>Choose a property</Heading>
            <Text tone="secondary">Select the hotel you want to manage today.</Text>
          </header>
          <ul className={styles.list}>
            {properties.map((property) => (
              <li key={property.id}>
                <a
                  className={styles.choice}
                  href={`/dashboard/${tenantId}?propertyId=${encodeURIComponent(property.id)}&section=overview`}
                >
                  <span>
                    <span>{property.name}</span>
                    <small>Open operations dashboard</small>
                  </span>
                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Stack>
      </Card>
    </main>
  );
}
