'use client';

import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';

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
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/notifications`;

  useEffect(() => {
    let active = true;
    setNotifications(null);
    void fetch(`${base}?page=1&pageSize=20`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load notifications.');
        return (await response.json()) as { items: Notification[] };
      })
      .then(({ items }) => {
        if (active) setNotifications(items);
      })
      .catch(() => {
        if (active) setError('Unable to load notifications.');
      });
    return () => {
      active = false;
    };
  }, [base]);

  async function markRead(notificationId: string) {
    const response = await fetch(`${base}/${notificationId}`, {
      method: 'PATCH',
      credentials: 'include',
    });
    if (!response.ok) {
      setError('Unable to update notification.');
      return;
    }
    const updated = (await response.json()) as Notification;
    setNotifications(
      (current) =>
        current?.map((notification) =>
          notification.id === updated.id
            ? { ...notification, readAt: updated.readAt }
            : notification,
        ) ?? null,
    );
  }

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
          {error ? <p role="alert">{error}</p> : null}
          {notifications?.length ? (
            <ul>
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <span>{notificationLabels[notification.type]}</span>
                  {notification.readAt === null ? (
                    <button onClick={() => void markRead(notification.id)} type="button">
                      Mark as read
                    </button>
                  ) : (
                    <span>Read</span>
                  )}
                </li>
              ))}
            </ul>
          ) : notifications === null ? (
            <DashboardLoadingSkeleton label="Loading notifications…" />
          ) : (
            <p>No notifications.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
