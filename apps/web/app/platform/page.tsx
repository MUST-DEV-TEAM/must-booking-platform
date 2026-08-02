'use client';

import { AppShell, Badge, Card, Heading, Stack, Text } from '@must/ui';
import { Building2, History, LayoutDashboard } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AuthRouteGuard, fetchSessionUser } from '../auth-routing';
import styles from './platform.module.css';

export const platformNavigation = [
  { href: '/platform', label: 'Overview', current: true, icon: LayoutDashboard },
  { href: '/platform/tenants', label: 'Tenants', icon: Building2 },
  { href: '/platform/audit', label: 'Audit Log', icon: History },
] as const;

type ProviderHealth = {
  status: 'checking' | 'healthy' | 'unhealthy';
  checkedAt: string | null;
  error?: string;
};

type DashboardHome = {
  stats: {
    tenants: number;
    properties: number;
    signupsThisWeek: number;
    plans: Record<string, number>;
  };
  activity: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    actorEmail: string | null;
    createdAt: string;
  }>;
};

const initialHealth: Record<'stripe' | 'pokpay', ProviderHealth> = {
  stripe: { status: 'checking', checkedAt: null },
  pokpay: { status: 'checking', checkedAt: null },
};

export default function PlatformPage() {
  const [dashboard, setDashboard] = useState<DashboardHome | null>(null);
  const [health, setHealth] = useState(initialHealth);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>();

  useEffect(() => {
    void fetchSessionUser()
      .then((user) => setUserEmail(user?.email))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch('/api/platform/dashboard', { credentials: 'include' }).then(async (response) => {
        if (!response.ok) throw new Error('Unable to load dashboard data.');
        return (await response.json()) as DashboardHome;
      }),
      fetch('/api/platform/provider-health', { credentials: 'include' }).then(async (response) => {
        if (!response.ok) throw new Error('Unable to load provider health.');
        return (await response.json()) as Record<'stripe' | 'pokpay', ProviderHealth>;
      }),
    ])
      .then(([home, providerHealth]) => {
        if (!active) return;
        setDashboard(home);
        setHealth(providerHealth);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Unable to load dashboard.');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthRouteGuard audience="platform">
      <AppShell navigation={platformNavigation} title="Platform operations" userEmail={userEmail}>
        <Stack className={styles.page} gap="lg">
          <header className={styles.header}>
            <div>
              <Text className={styles.eyebrow} tone="secondary">
                PLATFORM OPERATIONS
              </Text>
              <Heading>Overview</Heading>
              <Text tone="secondary">
                A live view of tenant growth, shared systems, and accountability.
              </Text>
            </div>
          </header>

          {error ? <Text className={styles.error}>{error}</Text> : null}

          <section aria-label="Platform statistics" className={styles.stats}>
            <Stat label="Tenants" value={dashboard?.stats.tenants ?? '—'} />
            <Stat label="Properties" value={dashboard?.stats.properties ?? '—'} />
            <Stat label="Signups this week" value={dashboard?.stats.signupsThisWeek ?? '—'} />
            <Card className={styles.statCard}>
              <Text tone="secondary">Plan breakdown</Text>
              <div className={styles.planList}>
                {Object.entries(dashboard?.stats.plans ?? {}).map(([plan, count]) => (
                  <span key={plan}>
                    <strong>{count}</strong> {plan}
                  </span>
                ))}
                {!dashboard ? <span>—</span> : null}
              </div>
            </Card>
          </section>

          <section className={styles.grid}>
            <Card>
              <div className={styles.panelHeader}>
                <div>
                  <Heading level={2}>System health</Heading>
                  <Text tone="secondary">Shared payment connections</Text>
                </div>
                <Badge tone="neutral">Live</Badge>
              </div>
              <div className={styles.healthList}>
                <HealthRow name="Stripe" value={health.stripe} />
                <HealthRow name="PokPay" value={health.pokpay} />
              </div>
            </Card>
            <Card>
              <div className={styles.panelHeader}>
                <div>
                  <Heading level={2}>Recent activity</Heading>
                  <Text tone="secondary">Platform-admin actions and reads</Text>
                </div>
              </div>
              <div className={styles.activityList}>
                {dashboard?.activity.length ? (
                  dashboard.activity.map((item) => (
                    <div className={styles.activity} key={item.id}>
                      <div>
                        <strong>{formatAction(item.action)}</strong>
                        <Text tone="secondary">
                          {item.actorEmail ?? 'Platform admin'} · {item.targetType} {item.targetId}
                        </Text>
                      </div>
                      <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                    </div>
                  ))
                ) : (
                  <Text tone="secondary">No activity recorded yet.</Text>
                )}
              </div>
            </Card>
          </section>
        </Stack>
      </AppShell>
    </AuthRouteGuard>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className={styles.statCard}>
      <Text tone="secondary">{label}</Text>
      <strong className={styles.statValue}>{value}</strong>
    </Card>
  );
}

function HealthRow({ name, value }: { name: string; value: ProviderHealth }) {
  const tone =
    value.status === 'healthy' ? 'success' : value.status === 'unhealthy' ? 'danger' : 'warning';
  return (
    <div className={styles.healthRow}>
      <div>
        <strong>{name}</strong>
        <Text tone="secondary">
          {value.checkedAt ? `Checked ${formatDate(value.checkedAt)}` : 'Awaiting first check'}
        </Text>
      </div>
      <Badge tone={tone}>{value.status}</Badge>
    </div>
  );
}

function formatAction(action: string) {
  return action
    .replace(/^platform\./, '')
    .replaceAll('.', ' › ')
    .replaceAll('_', ' ');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
