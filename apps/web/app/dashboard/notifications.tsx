'use client';

import { Bell } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import styles from './dashboard-shell.module.css';
import { DashboardLoadingSkeleton } from './loading-skeleton';

type Notification = {
  id: string;
  type:
    'BOOKING_CREATED' | 'BOOKING_NEEDS_ATTENTION' | 'PAYMENT_REFUNDED' | 'STAFF_SEAT_CAP_REACHED';
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

const notificationLabels: Record<Notification['type'], string> = {
  BOOKING_CREATED: 'Booking created',
  BOOKING_NEEDS_ATTENTION: 'Booking needs attention',
  PAYMENT_REFUNDED: 'Payment refunded',
  STAFF_SEAT_CAP_REACHED: 'Staff seat cap reached',
};

export function DashboardNotifications({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [open, setOpen] = useState(false);
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/notifications`;
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: ['dashboard', 'notifications', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}?page=1&pageSize=20`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load notifications.');
      return ((await response.json()) as { items: Notification[] }).items;
    },
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
      queryClient.setQueryData<Notification[]>(
        ['dashboard', 'notifications', tenantId, propertyId],
        (current) =>
          current?.map((notification) =>
            notification.id === updated.id
              ? { ...notification, readAt: updated.readAt }
              : notification,
          ) ?? [],
      );
    },
  });

  const notifications = notificationsQuery.data;
  const error = notificationsQuery.error ?? markReadMutation.error;
  const unread = notifications?.filter((notification) => notification.readAt === null).length ?? 0;

  return (
    <div className={styles.notifications}>
      <button
        aria-expanded={open}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className={styles.notificationBell}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Bell aria-hidden="true" size={20} />
        {unread ? <span className={styles.notificationBadge}>{unread}</span> : null}
      </button>
      {open ? (
        <section aria-label="Notifications" className={styles.notificationPanel}>
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
            <DashboardLoadingSkeleton label="Loading notifications…" />
          ) : (
            <p>No notifications.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
