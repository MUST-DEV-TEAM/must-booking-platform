export type InboxNotification = {
  id: string;
  type: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  capability: string;
  readAt: string | null;
  createdAt: string;
  needsAction: boolean | null;
  href: string | null;
  limitedContext: string | null;
  booking: {
    id: string;
    externalReference: string;
    status: string;
    guestName: string | null;
    startsOn: string;
    endsOn: string;
  } | null;
};
export type InboxPage = {
  items: InboxNotification[];
  page: number;
  pageSize: number;
  total: number;
  unreadTotal: number;
  counts: { critical: number; today: number; needsAction: number };
  version: number;
  through: string;
  canMarkRead: boolean;
  registry: {
    type: string;
    title: string;
    category: string;
    priority: string;
    capability: string;
  }[];
};
export class InboxError extends Error {
  constructor(
    message: string,
    public status: number,
    public reference: string | null,
  ) {
    super(message);
  }
}
export async function inboxRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new InboxError(
      typeof body?.message === 'string' ? body.message : 'Unable to load notifications.',
      response.status,
      response.headers.get('x-request-id'),
    );
  }
  return response.json() as Promise<T>;
}
/** Retries of an unchanged personal read intent keep their original key. */
export function createInboxWriter() {
  let intent = '',
    key = '';
  return (url: string, body: object) => {
    const next = JSON.stringify({ url, body });
    if (next !== intent) {
      intent = next;
      key = crypto.randomUUID();
    }
    return inboxRequest<{ updated: number; version: number }>(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': key },
    });
  };
}
/** Defense in depth: accept only API-generated links into this exact property dashboard. */
export function safeNotificationHref(
  href: string | null | undefined,
  tenantId: string,
  propertyId: string,
) {
  if (!href || !href.startsWith(`/dashboard/${tenantId}?`)) return null;
  try {
    const url = new URL(href, 'http://dashboard.local');
    if (
      url.origin !== 'http://dashboard.local' ||
      url.pathname !== `/dashboard/${tenantId}` ||
      url.searchParams.get('propertyId') !== propertyId
    )
      return null;
    const section = url.searchParams.get('section');
    return section === 'staff' || section === 'reservations' ? href : null;
  } catch {
    return null;
  }
}

/** Reject partial responses rather than inventing a count or exposing dead read controls. */
export function validateInboxPage(value: unknown): InboxPage {
  const v = value as Partial<InboxPage> | null;
  const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  if (
    !v ||
    !Array.isArray(v.items) ||
    !Array.isArray(v.registry) ||
    !count(v.total) ||
    !count(v.unreadTotal) ||
    !count(v.version) ||
    !count(v.page) ||
    !count(v.pageSize) ||
    typeof v.canMarkRead !== 'boolean' ||
    typeof v.through !== 'string' ||
    Number.isNaN(Date.parse(v.through)) ||
    !v.counts ||
    !count(v.counts.critical) ||
    !count(v.counts.today) ||
    !count(v.counts.needsAction) ||
    v.items.some(
      (r) =>
        !r ||
        typeof r.id !== 'string' ||
        typeof r.title !== 'string' ||
        typeof r.createdAt !== 'string',
    )
  )
    throw new InboxError('Notification data is incomplete. Reload the inbox.', 502, null);
  return v as InboxPage;
}
