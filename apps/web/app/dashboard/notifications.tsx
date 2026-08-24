'use client';

import { Card, Heading, NavigationPagination, Stack, StatePanel, Text } from '@must/ui';
import { Bell, LoaderCircle } from 'lucide-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import shellStyles from './dashboard-shell.module.css';
import styles from './notifications.module.css';

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

const notificationLabels: Record<Notification['type'], string> = {
  BOOKING_CREATED: 'Booking created',
  BOOKING_NEEDS_ATTENTION: 'Booking needs attention',
  PAYMENT_REFUNDED: 'Payment refunded',
  STAFF_SEAT_CAP_REACHED: 'Staff seat cap reached',
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

  return { notificationsQuery, markReadMutation };
}

export function DashboardNotifications({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [open, setOpen] = useState(false);
  const { notificationsQuery, markReadMutation } = useNotificationPage(tenantId, propertyId, 1);
  const notificationPage = notificationsQuery.data;
  const notifications = notificationPage?.items;
  const error = notificationsQuery.error ?? markReadMutation.error;
  const unread = notifications?.filter((notification) => notification.readAt === null).length ?? 0;
  const unreadBadge =
    notificationPage && notificationPage.total > NOTIFICATION_PAGE_SIZE
      ? '20+'
      : unread > 0
        ? String(unread)
        : '';

  return (
    <div className={shellStyles.notifications}>
      <button
        aria-expanded={open}
        aria-label={`Notifications${unreadBadge ? ` (${unreadBadge} unread)` : ''}`}
        className={shellStyles.notificationBell}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Bell aria-hidden="true" size={20} />
        {unreadBadge ? <span className={shellStyles.notificationBadge}>{unreadBadge}</span> : null}
      </button>
      {open ? (
        <section aria-label="Notifications" className={shellStyles.notificationPanel}>
          <h2>Notifications</h2>
          {error ? (
            <div role="alert">
              <p>{error.message}</p>
              {notificationsQuery.isError ? (
                <button onClick={() => void notificationsQuery.refetch()} type="button">
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {notifications?.length ? (
            <ul>
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <span>{notificationLabels[notification.type]}</span>
                  {notification.readAt === null ? (
                    <button
                      disabled={markReadMutation.isPending}
                      onClick={() => markReadMutation.mutate(notification.id)}
                      type="button"
                    >
                      Mark as read
                    </button>
                  ) : (
                    <span>Read</span>
                  )}
                </li>
              ))}
            </ul>
          ) : notificationsQuery.isPending ? (
            <StatePanel
              body={null}
              icon={<LoaderCircle aria-hidden="true" />}
              title="Loading notifications…"
              variant="loading"
            />
          ) : (
            <p>No notifications.</p>
          )}
          <a
            className={shellStyles.viewAllLink}
            href={notificationsInboxHref(tenantId, propertyId)}
          >
            View all notifications
          </a>
        </section>
      ) : null}
    </div>
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
    <Stack className={styles.inbox} gap="lg">
      <div className={styles.header}>
        <span className={styles.eyebrow}>Activity</span>
        <Heading>Notifications</Heading>
        <Text tone="secondary">
          Review booking, payment, and staff notifications for this property.
        </Text>
      </div>
      {error ? (
        <StatePanel
          body="Try again to reload the notifications inbox."
          icon={<LoaderCircle aria-hidden="true" />}
          title="Notifications unavailable"
          variant="error"
        />
      ) : notificationsQuery.isPending && !notificationPage ? (
        <StatePanel
          body={null}
          icon={<LoaderCircle aria-hidden="true" />}
          title="Loading notifications…"
          variant="loading"
        />
      ) : (
        <Card>
          {notificationPage?.items.length ? (
            <ul className={styles.list}>
              {notificationPage.items.map((notification) => {
                const unread = notification.readAt === null;
                return (
                  <li className={unread ? styles.itemUnread : styles.item} key={notification.id}>
                    <div className={styles.itemContent}>
                      <strong>{notificationLabels[notification.type]}</strong>
                      <span className={unread ? styles.statusUnread : styles.statusRead}>
                        {unread ? 'Unread' : 'Read'}
                      </span>
                      <time dateTime={notification.createdAt}>
                        {formatNotificationDate(notification.createdAt)}
                      </time>
                    </div>
                    <div className={styles.itemActions}>
                      {unread ? (
                        <button
                          className="must-button must-button--secondary"
                          disabled={markReadMutation.isPending}
                          onClick={() => markReadMutation.mutate(notification.id)}
                          type="button"
                        >
                          Mark as read
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Text>No notifications.</Text>
          )}
          {notificationPage ? (
            <NavigationPagination
              label="Notifications pages"
              onPageChange={setPage}
              page={notificationPage.page}
              pageSize={notificationPage.pageSize}
              total={notificationPage.total}
            />
          ) : null}
        </Card>
      )}
    </Stack>
  );
}

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
