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
  canSendCopy?: boolean;
  resendOfMessageId?: string | null;
  renderedPreview?: {
    subject: string;
    html: string;
    text: string;
    capturedAt: string;
    expiresAt: string;
  } | null;
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
/** Replay the original approved snapshot after an uncertain response, even if background metadata refreshes. */
export function createEmailWriter() {
  type Approved = {
    intent: string;
    semantic: string;
    key: string;
    url: string;
    method: string;
    wire: string;
  };
  let intent = '',
    key = '',
    pending: Approved | undefined;
  return async <T>(url: string, body: object, method = 'POST'): Promise<T> => {
    const wire = JSON.stringify(body);
    const next = JSON.stringify({ url, body, method });
    // Versions/cutoffs are observations, not a fresh user decision after a lost response.
    const semantic = JSON.stringify({
      url,
      method,
      body: Object.fromEntries(
        Object.entries(body).filter(([name]) => name !== 'version' && name !== 'through'),
      ),
    });
    const unresolved = pending;
    let approved: Approved;
    if (pending?.semantic === semantic) approved = pending;
    else {
      if (next !== intent) {
        intent = next;
        key = crypto.randomUUID();
      }
      approved = { intent: next, semantic, key, url, method, wire };
    }
    intent = approved.intent;
    key = approved.key;
    try {
      const response = await emailRequest<T>(approved.url, {
        method: approved.method,
        body: approved.wire,
        headers: { 'Idempotency-Key': approved.key },
      });
      pending = undefined;
      return response;
    } catch (error) {
      pending =
        error instanceof EmailRequestError && error.status < 500
          ? unresolved?.semantic !== approved.semantic
            ? unresolved
            : undefined
          : approved;
      throw error;
    }
  };
}
