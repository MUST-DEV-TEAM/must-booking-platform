'use client';

import { Text } from '@must/ui';
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
  return <DashboardShell tenantId={tenantId} />;
}
