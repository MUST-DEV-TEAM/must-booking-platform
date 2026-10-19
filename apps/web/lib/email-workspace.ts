export type EmailTemplate = {
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
  live: { subject: string; body: string } | null;
  draft: EmailRevision | null;
  history: EmailRevision[];
};
export type EmailMessage = {
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
export type EmailPage = { items: EmailMessage[]; total: number; page: number; pageSize: number };
export type EmailOverview = {
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
