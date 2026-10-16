'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CircleAlert, CirclePlus, Undo2, Users, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { PageHero } from '../../components/ui/page-hero';
import { Pagination } from '../../components/ui/pagination';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';

export type Notification = {
  id: string;
  type:
    'BOOKING_CREATED' | 'BOOKING_NEEDS_ATTENTION' | 'PAYMENT_REFUNDED' | 'STAFF_SEAT_CAP_REACHED';
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: Notification[];
  page: number;
  pageSize: number;
  total: number;
};

const NOTIFICATION_PAGE_SIZE = 20;
const NOTIFICATION_DROPDOWN_LIMIT = 10;

const notificationLabels: Record<Notification['type'], string> = {
  BOOKING_CREATED: 'Booking created',
  BOOKING_NEEDS_ATTENTION: 'Booking needs attention',
  PAYMENT_REFUNDED: 'Payment refunded',
  STAFF_SEAT_CAP_REACHED: 'Staff seat cap reached',
};

const notificationHints: Record<Notification['type'], string> = {
  BOOKING_CREATED: 'A new reservation was made.',
  BOOKING_NEEDS_ATTENTION: 'Open the reservation and follow up.',
  PAYMENT_REFUNDED: 'A refund was recorded.',
  STAFF_SEAT_CAP_REACHED: 'The staff limit of the plan is reached.',
};

function notificationQueryKey(tenantId: string, propertyId: string) {
  return ['dashboard', 'notifications', tenantId, propertyId] as const;
}

export function notificationsInboxHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=notifications`;
}

function useNotificationPage(tenantId: string, propertyId: string, page: number) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/notifications`;
  const queryClient = useQueryClient();
  const rootQueryKey = notificationQueryKey(tenantId, propertyId);
  const notificationsQuery = useQuery({
    queryKey: [...rootQueryKey, page],
    queryFn: async (): Promise<NotificationPage> => {
      const response = await fetch(`${base}?page=${page}&pageSize=${NOTIFICATION_PAGE_SIZE}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to load notifications.');
      const result = (await response.json()) as Partial<NotificationPage> & {
        items?: Notification[];
      };
      const items = result.items ?? [];
      return {
        items,
        page: result.page ?? page,
        pageSize: result.pageSize ?? NOTIFICATION_PAGE_SIZE,
        total: result.total ?? items.length,
      };
    },
    placeholderData: keepPreviousData,
  });
  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await fetch(`${base}/${notificationId}`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to update notification.');
      return (await response.json()) as Notification;
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<NotificationPage>({ queryKey: rootQueryKey }, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((notification) =>
                notification.id === updated.id
                  ? { ...notification, readAt: updated.readAt }
                  : notification,
              ),
            }
          : current,
      );
    },
  });
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/mark-all-read`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to mark all notifications as read.');
    },
    onSuccess: () => {
      const now = new Date().toISOString();
      queryClient.setQueriesData<NotificationPage>({ queryKey: rootQueryKey }, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((notification) =>
                notification.readAt === null ? { ...notification, readAt: now } : notification,
              ),
            }
          : current,
      );
    },
  });

  return { notificationsQuery, markReadMutation, markAllReadMutation };
}

/** Icon, tone and destination for a notification; bookings and payments open their reservation. */
function notificationLook(notification: Notification, tenantId: string, propertyId: string) {
  const icons: Record<Notification['type'], LucideIcon> = {
    BOOKING_CREATED: CirclePlus,
    BOOKING_NEEDS_ATTENTION: CircleAlert,
    PAYMENT_REFUNDED: Undo2,
    STAFF_SEAT_CAP_REACHED: Users,
  };
  const bookingId =
    typeof notification.payload.bookingId === 'string' ? notification.payload.bookingId : null;
  const base = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}`;
  const href = bookingId
    ? `${base}&section=reservations&reservation=${bookingId}`
    : notification.type === 'STAFF_SEAT_CAP_REACHED'
      ? `${base}&section=staff`
      : notificationsInboxHref(tenantId, propertyId);
  return {
    Icon: icons[notification.type],
    href,
    attention: notification.type === 'BOOKING_NEEDS_ATTENTION',
  };
}

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatNotificationDate(value);
}

const iconBox = 'flex shrink-0 items-center justify-center rounded-lg';
const iconTone = (attention: boolean) =>
  attention ? 'bg-warning-surface text-warning' : 'bg-muted text-muted-foreground';

export function DashboardNotifications({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const { notificationsQuery, markReadMutation, markAllReadMutation } = useNotificationPage(
    tenantId,
    propertyId,
    1,
  );
  const notificationPage = notificationsQuery.data;
  const notifications = notificationPage?.items.slice(0, NOTIFICATION_DROPDOWN_LIMIT);
  const error = notificationsQuery.error ?? markReadMutation.error ?? markAllReadMutation.error;
  const unread =
    notificationPage?.items.filter((notification) => notification.readAt === null).length ?? 0;
  const unreadBadge =
    notificationPage && notificationPage.total > NOTIFICATION_PAGE_SIZE
      ? '20+'
      : unread > 0
        ? String(unread)
        : '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-10"
          aria-label={`Notifications${unreadBadge ? ` (${unreadBadge} unread)` : ''}`}
        >
          <Bell aria-hidden="true" />
          {unreadBadge ? (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-bold text-white">
              {unreadBadge}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1rem))] p-2">
        <div className="flex items-center justify-between px-2 py-1">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <button
              type="button"
              disabled={markAllReadMutation.isPending}
              onClick={() => markAllReadMutation.mutate()}
              className="rounded-sm bg-transparent text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {markAllReadMutation.isPending ? 'Marking…' : 'Mark all as read'}
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {error ? (
          <div role="alert" className="px-2 py-3 text-sm text-destructive">
            {error.message}
            {notificationsQuery.isError ? (
              <button
                type="button"
                className="ml-2 bg-transparent font-semibold underline"
                onClick={() => void notificationsQuery.refetch()}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {notifications?.length ? (
          notifications.map((notification) => {
            const { Icon, href, attention } = notificationLook(notification, tenantId, propertyId);
            const isUnread = notification.readAt === null;
            return (
              <DropdownMenuItem
                key={notification.id}
                asChild
                className="min-h-14 items-start gap-3 px-2 py-2.5"
              >
                <a
                  href={href}
                  onClick={() => {
                    if (isUnread) markReadMutation.mutate(notification.id);
                  }}
                >
                  <span className={`mt-0.5 size-8 ${iconBox} ${iconTone(attention)}`}>
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {notificationLabels[notification.type]}
                      {isUnread ? (
                        <span aria-label="Unread" className="size-1.5 rounded-full bg-primary" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {notificationHints[notification.type]}
                    </span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-[10px] text-muted-foreground">
                    {timeAgo(notification.createdAt)}
                  </span>
                </a>
              </DropdownMenuItem>
            );
          })
        ) : notificationsQuery.isPending ? (
          <p className="m-0 px-2 py-3 text-sm text-muted-foreground">Loading notifications…</p>
        ) : (
          <p className="m-0 px-2 py-3 text-sm text-muted-foreground">No notifications.</p>
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
  const [page, setPage] = useState(1);
  const { notificationsQuery, markReadMutation } = useNotificationPage(tenantId, propertyId, page);
  const notificationPage = notificationsQuery.data;
  const error = notificationsQuery.error ?? markReadMutation.error;

  return (
    <div className="space-y-4">
      <PageHero
        eyebrow="Activity"
        title="Notifications"
        description="Review booking, payment, and staff notifications for this property."
      />
      {error ? (
        <ErrorPanel
          title="Notifications unavailable"
          description="Try again to reload the notifications inbox."
          onRetry={() => void notificationsQuery.refetch()}
        />
      ) : notificationsQuery.isPending && !notificationPage ? (
        <ListSkeleton rows={5} />
      ) : (
        <Card className="gap-0 py-0">
          {notificationPage?.items.length ? (
            <ul className="m-0 list-none divide-y p-0">
              {notificationPage.items.map((notification) => {
                const unread = notification.readAt === null;
                const { Icon, href, attention } = notificationLook(notification, tenantId, propertyId);
                return (
                  <li key={notification.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={`size-9 ${iconBox} ${iconTone(attention)}`}>
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <a
                      href={href}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 text-inherit no-underline hover:underline"
                      onClick={() => {
                        if (unread) markReadMutation.mutate(notification.id);
                      }}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <strong>{notificationLabels[notification.type]}</strong>
                        <span
                          className={
                            unread ? 'text-xs font-bold text-primary' : 'text-xs text-muted-foreground'
                          }
                        >
                          {unread ? 'Unread' : 'Read'}
                        </span>
                      </span>
                      <time dateTime={notification.createdAt} className="text-xs text-muted-foreground">
                        {formatNotificationDate(notification.createdAt)}
                      </time>
                    </a>
                    {unread ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={markReadMutation.isPending}
                        onClick={() => markReadMutation.mutate(notification.id)}
                      >
                        Mark as read
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-6">
              <EmptyPanel
                title="No notifications"
                description="New bookings, payments and alerts will show here."
              />
            </div>
          )}
          {notificationPage ? (
            <Pagination
              page={notificationPage.page}
              pageSize={notificationPage.pageSize}
              total={notificationPage.total}
              onPage={setPage}
              noun="notifications"
            />
          ) : null}
        </Card>
      )}
    </div>
  );
}

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
