'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { PageHeader } from '../../components/ui/page-header';
import { QuickPeek } from '../../components/ui/quick-peek';
import { RecordDirectory } from '../../components/ui/record-directory';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { StatTile } from '../../components/ui/stat-tile';
import { TabBar } from '../../components/ui/tab-bar';
import {
  createInboxWriter,
  validateInboxPage,
  inboxRequest,
  InboxError,
  safeNotificationHref,
  type InboxNotification,
  type InboxPage,
} from '../../lib/notification-inbox';
export type Notification = InboxNotification;
export type NotificationPage = InboxPage;
export function notificationsInboxHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=notifications`;
}
function useInbox(tenantId: string, propertyId: string, params: string) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/notifications`,
    root = ['dashboard', 'notifications', tenantId, propertyId];
  const client = useQueryClient(),
    writer = useRef(createInboxWriter());
  const query = useQuery({
    queryKey: [...root, params],
    queryFn: async () => validateInboxPage(await inboxRequest<unknown>(`${base}?${params}`)),
    refetchInterval: 60000,
  });
  const mark = useMutation({
    mutationFn: ({ kind, ids }: { kind: 'single' | 'visible' | 'all'; ids?: string[] }) => {
      if (!query.data) throw new Error('Reload the inbox before marking read.');
      const suffix =
        kind === 'single' ? ids![0] : kind === 'all' ? 'mark-all-read' : 'mark-visible-read';
      return writer.current(`${base}/${suffix}`, {
        version: query.data.version,
        ...(kind === 'all' ? { through: query.data.through } : kind === 'visible' ? { ids } : {}),
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: root });
      await client.invalidateQueries({ queryKey: ['notification-detail', base] });
    },
    onError: () => client.invalidateQueries({ queryKey: root }),
  });
  return { base, query, mark };
}
function Failure({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <ErrorPanel
      title={
        error instanceof InboxError && error.status === 403
          ? 'Notifications access denied'
          : 'Notifications unavailable'
      }
      description={error.message}
      reference={error instanceof InboxError ? (error.reference ?? undefined) : undefined}
      onRetry={retry}
    />
  );
}
export function DashboardNotifications({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const { query, mark } = useInbox(tenantId, propertyId, 'page=1&pageSize=10');
  const canMark = !!query.data?.canMarkRead && !mark.isPending;
  const unread = query.error ? undefined : query.data?.unreadTotal;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-10"
          aria-label={`Notifications${unread ? ` (${unread > 99 ? '99+' : unread} unread)` : ''}`}
        >
          <Bell aria-hidden="true" />
          {unread ? (
            <Badge variant="danger" className="absolute -top-2 -right-2">
              {unread > 99 ? '99+' : unread}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-1rem))]">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!canMark}
              onClick={() => mark.mutate({ kind: 'all' })}
            >
              <CheckCheck aria-hidden="true" /> Mark all as read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {query.isPending ? (
          <DropdownMenuLabel>Loading notifications...</DropdownMenuLabel>
        ) : query.error ? (
          <DropdownMenuLabel>Unable to load notifications.</DropdownMenuLabel>
        ) : query.data?.items.length ? (
          query.data.items.slice(0, 10).map((row) => (
            <div key={row.id} className="flex items-center gap-1">
              <DropdownMenuItem asChild className="flex-1">
                <a href={`${notificationsInboxHref(tenantId, propertyId)}&notification=${row.id}`}>
                  <span className="flex flex-col gap-1 py-1">
                    <span className={row.readAt ? 'font-normal' : 'font-semibold'}>
                      {!row.readAt ? (
                        <span
                          aria-hidden="true"
                          className="mr-2 inline-block size-2 rounded-full bg-primary"
                        />
                      ) : null}
                      {row.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.category} / {row.priority} / {new Date(row.createdAt).toLocaleString()}
                    </span>
                  </span>
                </a>
              </DropdownMenuItem>
              {!row.readAt && query.data?.canMarkRead ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={`Mark "${row.title}" as read`}
                  disabled={!canMark}
                  onClick={() => mark.mutate({ kind: 'single', ids: [row.id] })}
                >
                  <Check aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))
        ) : (
          <DropdownMenuLabel>No notifications yet.</DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={notificationsInboxHref(tenantId, propertyId)}>View all notifications</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function NotificationsInbox({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [tab, setTab] = useState('all'),
    [category, setCategory] = useState(''),
    [priority, setPriority] = useState(''),
    [search, setSearch] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('notification'),
  );
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(tab === 'unread'
      ? { unread: '1' }
      : tab === 'action'
        ? { needsAction: '1' }
        : tab === 'resolved'
          ? { resolved: '1' }
          : {}),
    ...(category ? { category } : {}),
    ...(priority ? { priority } : {}),
    ...(search ? { search } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const { base, query, mark } = useInbox(tenantId, propertyId, params.toString()),
    data = query.error ? undefined : query.data;
  const client = useQueryClient();
  const [confirm, setConfirm] = useState<'resolve' | 'reopen' | null>(null);
  const resolution = useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: 'resolve' | 'reopen';
      note?: string;
    }) =>
      inboxRequest(`${base}/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify(action === 'resolve' ? { note: note || undefined } : {}),
      }),
    onSettled: async () => {
      await client.invalidateQueries({
        queryKey: ['dashboard', 'notifications', tenantId, propertyId],
      });
      await client.invalidateQueries({ queryKey: ['notification-detail', base] });
    },
  });
  const detail = useQuery({
    queryKey: ['notification-detail', base, selected],
    queryFn: () => inboxRequest<InboxNotification>(`${base}/${selected}`),
    enabled: !!selected,
  });
  const change = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  const error = query.error ?? mark.error,
    canMark = !!data?.canMarkRead && !mark.isPending && !mark.error && !query.isFetching;
  const row =
    selected && !query.error && !detail.error
      ? (data?.items.find((r) => r.id === selected) ?? detail.data)
      : null;
  const href = safeNotificationHref(row?.href, tenantId, propertyId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Your personal inbox. Reading an alert does not resolve the underlying issue."
        actions={
          <Button
            variant="outline"
            disabled={!canMark || !data?.unreadTotal}
            onClick={() => mark.mutate({ kind: 'all' })}
          >
            Mark all as read
          </Button>
        }
      />
      {data && !data.canMarkRead ? (
        <Alert>
          <AlertDescription>
            Read only. Verify your email to mark notifications read.
          </AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Unread" value={data.unreadTotal} />
          <StatTile label="Critical" value={data.counts?.critical ?? 'Unknown'} />
          <StatTile
            label="Today"
            value={data.counts?.today ?? 'Unknown'}
            note="Property local date"
          />
          <StatTile label="Needs action" value={data.counts?.needsAction ?? 'Unknown'} />
        </div>
      ) : null}
      <TabBar
        label="Notification views"
        current={tab}
        onSelect={change(setTab)}
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'unread', label: 'Unread', count: data?.unreadTotal },
          { id: 'action', label: 'Needs action', count: data?.counts?.needsAction },
          { id: 'resolved', label: 'Resolved' },
        ]}
      />
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <FormField label="Category">
          <Combobox
            label="Category"
            value={category}
            onChange={change(setCategory)}
            options={[
              { value: '', label: 'All categories' },
              ...['Reservations', 'Payments', 'Providers', 'Emails', 'System'].map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
        </FormField>
        <FormField label="Priority">
          <Combobox
            label="Priority"
            value={priority}
            onChange={change(setPriority)}
            options={[
              { value: '', label: 'All priorities' },
              ...['Critical', 'High', 'Medium', 'Low'].map((value) => ({ value, label: value })),
            ]}
          />
        </FormField>
        <FormField label="Search inbox">
          <Input
            aria-label="Search inbox"
            placeholder="Type, reservation, guest"
            value={search}
            maxLength={100}
            onChange={(e) => change(setSearch)(e.target.value)}
          />
        </FormField>
        <FormField label="From">
          <Input
            aria-label="From date"
            type="date"
            value={from}
            onChange={(e) => change(setFrom)(e.target.value)}
          />
        </FormField>
        <FormField label="To">
          <Input
            aria-label="To date"
            type="date"
            value={to}
            onChange={(e) => change(setTo)(e.target.value)}
          />
        </FormField>
      </div>
      {error ? (
        <Failure
          error={error}
          retry={() => {
            mark.reset();
            void query.refetch();
          }}
        />
      ) : query.isPending ? (
        <ListSkeleton rows={5} />
      ) : data ? (
        <RecordDirectory
          rows={data.items}
          storageKey="must.notifications.table"
          initialSort={{ key: 'createdAt', direction: 'desc' }}
          onRow={(r) => setSelected(r.id)}
          emptyTitle={
            tab === 'unread'
              ? 'No unread notifications'
              : search || category || priority || from || to
                ? 'No matching notifications'
                : 'No notifications'
          }
          columns={[
            {
              id: 'title',
              label: 'Notification',
              value: (r) => r.title,
              render: (r) => (
                <span className="flex flex-wrap items-center gap-2">
                  {r.title}
                  {!r.readAt ? <Badge variant="info">Unread</Badge> : null}
                </span>
              ),
            },
            { id: 'category', label: 'Category', value: (r) => r.category },
            {
              id: 'priority',
              label: 'Priority',
              value: (r) => r.priority,
              render: (r) => (
                <Badge
                  variant={
                    r.priority === 'Critical'
                      ? 'danger'
                      : r.priority === 'High'
                        ? 'warning'
                        : 'secondary'
                  }
                >
                  {r.priority}
                </Badge>
              ),
            },
            {
              id: 'action',
              label: 'Issue',
              value: (r) =>
                r.resolution?.state === 'resolved'
                  ? 'Resolved'
                  : r.needsAction === true
                    ? 'Needs action'
                    : r.needsAction === null
                      ? 'Unknown'
                      : 'Information',
            },
            {
              id: 'reference',
              label: 'Reservation',
              value: (r) =>
                r.booking?.externalReference ?? (r.limitedContext ? 'Limited context' : '-'),
            },
            {
              id: 'createdAt',
              label: 'Received',
              value: (r) => r.createdAt,
              render: (r) => new Date(r.createdAt).toLocaleString(),
            },
          ]}
          actions={(r) => [
            { label: 'View detail', onSelect: () => setSelected(r.id) },
            ...(!r.readAt
              ? [
                  {
                    label: 'Mark as read',
                    disabled: !canMark,
                    onSelect: () => mark.mutate({ kind: 'single', ids: [r.id] }),
                  },
                ]
              : []),
          ]}
          visibleActions={(visible) => [
            {
              label: 'Mark visible as read',
              disabled: !canMark || !visible.some((r) => !r.readAt),
              onSelect: () => mark.mutate({ kind: 'visible', ids: visible.map((r) => r.id) }),
            },
          ]}
          pagination={{
            page,
            pageSize,
            total: data.total,
            onPage: setPage,
            onPageSize: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Categories and routing</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={(data?.registry ?? []).map((r) => ({
              label: r.title,
              value: `${r.category} / ${r.priority} / ${r.capability}`,
            }))}
          />
          <p className="m-0 pt-3 text-sm text-muted-foreground">
            Notifications are personal awareness. Needs Attention is the shared work queue. Emails
            manages outbound messages. Inbox alerts expire after 90 days; source records remain.
            Providers and Emails have no registered inbox types yet.
          </p>
        </CardContent>
      </Card>
      <QuickPeek
        open={!!selected}
        onClose={() => setSelected(null)}
        title={row?.title ?? 'Notification detail'}
        description="Recorded alert and current operational context"
        badges={
          row ? (
            <>
              <Badge>{row.category}</Badge>
              <Badge>{row.priority}</Badge>
              <Badge variant={row.readAt ? 'secondary' : 'info'}>
                {row.readAt ? 'Read' : 'Unread'}
              </Badge>
              {row.resolution?.state === 'resolved' ? (
                <Badge variant="success">Resolved</Badge>
              ) : row.resolution?.state === 'open' ? (
                <Badge variant="warning">Needs action</Badge>
              ) : null}
            </>
          ) : null
        }
        actions={
          row ? (
            <>
              {href ? (
                <Button asChild>
                  <a href={href}>
                    {row.type === 'STAFF_SEAT_CAP_REACHED' ? 'Open staff' : 'Open reservation'}
                  </a>
                </Button>
              ) : null}
              {!row.readAt ? (
                <Button
                  variant="outline"
                  disabled={!canMark}
                  onClick={() => mark.mutate({ kind: 'single', ids: [row.id] })}
                >
                  Mark as read
                </Button>
              ) : null}
              {data?.canMarkRead && row.actionable && row.resolution?.state === 'open' ? (
                <Button variant="outline" onClick={() => setConfirm('resolve')}>
                  Mark as resolved
                </Button>
              ) : null}
              {data?.canMarkRead &&
              row.resolution?.state === 'resolved' &&
              row.resolution.source === 'manual' ? (
                <Button variant="outline" onClick={() => setConfirm('reopen')}>
                  Reopen
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detail.error ? (
          <Failure error={detail.error} retry={() => void detail.refetch()} />
        ) : row ? (
          <>
            <p className="m-0 text-sm">{row.description}</p>
            {row.limitedContext ? (
              <Alert>
                <AlertDescription>Limited context: {row.limitedContext}</AlertDescription>
              </Alert>
            ) : null}
            <DetailList
              items={[
                { label: 'Received', value: new Date(row.createdAt).toLocaleString() },
                {
                  label: 'Read by you',
                  value: row.readAt ? new Date(row.readAt).toLocaleString() : 'Not read',
                },
                {
                  label: 'Issue',
                  value:
                    row.resolution?.state === 'resolved'
                      ? row.resolution.source === 'manual'
                        ? 'Resolved by a person'
                        : 'Resolved in the underlying record'
                      : row.needsAction === true
                        ? 'Needs action - reading does not resolve it'
                        : row.needsAction === null
                          ? 'Unknown - related context unavailable'
                          : 'Information',
                },
                {
                  label: 'Resolved by',
                  value:
                    row.resolution?.state === 'resolved' && row.resolution.source === 'manual'
                      ? `${row.resolution.by}${row.resolution.at ? `, ${new Date(row.resolution.at).toLocaleString()}` : ''}`
                      : null,
                },
                {
                  label: 'Resolution note',
                  value: row.resolution?.state === 'resolved' ? row.resolution.note : null,
                },
                {
                  label: 'Read by',
                  value: row.readBy?.length
                    ? row.readBy
                        .map(
                          (r) =>
                            `${r.name ?? 'A staff member'} (${new Date(r.readAt).toLocaleString()})`,
                        )
                        .join(', ')
                    : null,
                },
                { label: 'Reservation', value: row.booking?.externalReference },
                { label: 'Status', value: row.booking?.status },
                { label: 'Guest', value: row.booking?.guestName },
                {
                  label: 'Stay',
                  value: row.booking ? `${row.booking.startsOn} to ${row.booking.endsOn}` : null,
                },
              ]}
            />
          </>
        ) : detail.isPending ? (
          <ListSkeleton rows={3} />
        ) : (
          <EmptyPanel title="Notification unavailable" />
        )}
      </QuickPeek>
      <ConfirmDialog
        open={confirm === 'resolve'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Mark as resolved?"
        description="The alert is marked resolved for everyone, with your name and the time. The underlying issue is not changed."
        confirmLabel="Mark as resolved"
        cancelLabel="Cancel"
        reasonLabel="Note (optional)"
        reasonPlaceholder="What was done?"
        onConfirm={async (note) => {
          if (row) await resolution.mutateAsync({ id: row.id, action: 'resolve', note });
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'reopen'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reopen this alert?"
        description="It will show as needing action again for everyone."
        confirmLabel="Reopen"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (row) await resolution.mutateAsync({ id: row.id, action: 'reopen' });
          setConfirm(null);
        }}
      />
    </div>
  );
}
