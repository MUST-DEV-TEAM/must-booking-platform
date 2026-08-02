'use client';

import { AppShell, Card, Heading, Stack, Text } from '@must/ui';
import { Building2, History, LayoutDashboard } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AuthRouteGuard, fetchSessionUser } from '../../auth-routing';
import styles from '../platform.module.css';
import tableStyles from '../tenants/tenant-list.module.css';
import auditStyles from './audit-log.module.css';

export const navigation = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/tenants', label: 'Tenants', icon: Building2 },
  { href: '/platform/audit', label: 'Audit Log', current: true, icon: History },
] as const;

export type PlatformAuditLog = {
  id: string;
  tenantId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  actorType: 'PLATFORM_ADMIN';
  actorEmail: string | null;
  createdAt: string;
};

export type PlatformAuditLogPage = {
  items: PlatformAuditLog[];
  page: number;
  pageSize: number;
  total: number;
};

export function AuditLogView({
  auditLog,
  loading,
  onPageChange,
}: {
  auditLog: PlatformAuditLogPage | null;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const page = auditLog?.page ?? 1;
  const pageSize = auditLog?.pageSize ?? 50;
  const total = auditLog?.total ?? 0;
  const hasPrevious = page > 1;
  const hasNext = page * pageSize < total;
  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.header}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            PLATFORM OPERATIONS
          </Text>
          <Heading>Audit Log</Heading>
          <Text tone="secondary">Platform-admin actions and reads across MUST Booking.</Text>
        </div>
      </header>
      <Card>
        {loading ? <Text tone="secondary">Loading audit log…</Text> : null}
        {!loading && auditLog?.items.length === 0 ? (
          <Text tone="secondary">No platform activity recorded yet.</Text>
        ) : null}
        {!loading && auditLog?.items.length ? (
          <div className={tableStyles.tableWrap}>
            <table className={tableStyles.table}>
              <caption className={tableStyles.caption}>Platform audit log</caption>
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.items.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                    </th>
                    <td>{entry.actorEmail ?? 'Platform admin'}</td>
                    <td>{formatAction(entry.action)}</td>
                    <td>{`${entry.targetType} ${entry.targetId}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loading && auditLog ? (
          <nav aria-label="Audit log pages" className={auditStyles.pager}>
            <Text tone="secondary">
              Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
            </Text>
            <div className={auditStyles.pagerActions}>
              <button disabled={!hasPrevious} onClick={() => onPageChange(page - 1)} type="button">
                Previous
              </button>
              <button disabled={!hasNext} onClick={() => onPageChange(page + 1)} type="button">
                Next
              </button>
            </div>
          </nav>
        ) : null}
      </Card>
    </Stack>
  );
}

export default function PlatformAuditPage() {
  const [auditLog, setAuditLog] = useState<PlatformAuditLogPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>();

  useEffect(() => {
    void fetchSessionUser()
      .then((user) => setUserEmail(user?.email))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(`/api/platform/audit?page=${page}&pageSize=50`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load audit log.');
        return (await response.json()) as PlatformAuditLogPage;
      })
      .then((result) => active && setAuditLog(result))
      .catch(
        (reason: unknown) =>
          active &&
          setError(reason instanceof Error ? reason.message : 'Unable to load audit log.'),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [page]);

  return (
    <AuthRouteGuard audience="platform">
      <AppShell navigation={navigation} title="Platform operations" userEmail={userEmail}>
        {error ? <Text className={styles.error}>{error}</Text> : null}
        <AuditLogView auditLog={auditLog} loading={loading} onPageChange={setPage} />
      </AppShell>
    </AuthRouteGuard>
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
