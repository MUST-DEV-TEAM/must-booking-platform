'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import styles from './selection.module.css';

type Membership = { tenantId: string; organizationName: string; role: string };

export function TenantPicker() {
  const router = useRouter();
  const [items, setItems] = useState<Membership[] | null>(null);
  useEffect(() => {
    void fetch('/api/auth/memberships', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : { memberships: [] }))
      .then((value) => setItems(value.memberships))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (items?.length === 1) router.replace(`/dashboard/${items[0].tenantId}`);
  }, [items, router]);
  if (items?.length === 1) return null;
  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <Stack gap="lg">
          <header>
            <p className={styles.eyebrow}>MUST BOOKING</p>
            <Heading>Choose a workspace</Heading>
            <Text tone="secondary">Select the hotel group you want to work with.</Text>
          </header>
          {items === null ? (
            <Text>Loading workspaces…</Text>
          ) : items.length === 0 ? (
            <Text>No workspaces available.</Text>
          ) : (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.tenantId}>
                  <a className={styles.choice} href={`/dashboard/${item.tenantId}`}>
                    <span>
                      <span>{item.organizationName}</span>
                      <small>{item.role.toLowerCase()} access</small>
                    </span>
                    <span className={styles.arrow} aria-hidden="true">
                      →
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </Card>
    </main>
  );
}
