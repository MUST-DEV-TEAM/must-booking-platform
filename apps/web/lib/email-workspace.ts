export type EmailTemplate = {
  previewText?: string;
  audience?: string;
  triggerAvailable?: boolean;
  unavailableReason?: string | null;
  key: string;
  label: string;
  subject: string;
  body: string;
  placeholders: string[];
  custom: boolean;
  enabled?: boolean;
  hasDraft?: boolean;
  locales?: string[];
  defaultSubject?: string;
  defaultBody?: string;
};
export type EmailRevision = {
  previewText?: string;
  revision: number;
  subject: string;
  body: string;
  actorUserId: string;
  createdAt: string;
};
export type EmailVersions = {
  key: string;
  language: 'en' | 'sq';
  version: number;
  live: { subject: string; body: string; previewText?: string } | null;
  draft: EmailRevision | null;
  history: EmailRevision[];
};
export type EmailMessage = {
  bookingHref?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  timeline?: {
    id: string;
    kind: string;
    status: string;
    attemptCount: number;
    provider: string | null;
    providerMessageId: string | null;
    observedAt: string;
  }[];
  timelineTruncated?: boolean;
  timelineHasCreation?: boolean;
  id: string;
  label: string;
  eventType: string;
  recipient: string;
  subject: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  bookingReference: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  canResend: boolean;
  retryUnavailableReason?: string | null;
  version: number;
};
export type EmailPage = {
  observedAt?: string;
  exportVersion?: number;
  items: EmailMessage[];
  total: number;
  page: number;
  pageSize: number;
  timezone?: string;
  topics?: { value: string; label: string }[];
};
export type EmailOverview = {
  volume24h: number;
  volume7d: number;
  attempted7d: number;
  bounceRate: number | null;
  complaintRate: number | null;
  queued: number;
  oldestQueued: string | null;
  suppressedAddresses: number;
  failingTopics: { topic: string; label: string; count: number }[];
  actionNeeded: {
    id: string;
    label: string;
    eventType: string;
    recipient: string;
    status: string;
    lastError: string | null;
    createdAt: string;
  }[];

  counts: { status: string; count: number; today: number }[];
  days: number;
  testTrafficExcluded: boolean;
  domainAuthentication: string;
};
export class EmailRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public reference: string | null,
  ) {
    super(message);
  }
}
export async function emailRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new EmailRequestError(
      typeof body?.message === 'string' ? body.message : 'Email request failed.',
      response.status,
      response.headers.get('x-request-id'),
    );
  }
  return response.json() as Promise<T>;
}
/** Keep an operation key across a retry of the same intent, including a lost response. */
export function createEmailWriter() {
  let intent = '',
    key = '';
  return <T>(url: string, body: object, method = 'POST') => {
    const next = JSON.stringify({ url, body, method });
    if (next !== intent) {
      intent = next;
      key = crypto.randomUUID();
    }
    return emailRequest<T>(url, {
      method,
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': key },
    });
  };
}
