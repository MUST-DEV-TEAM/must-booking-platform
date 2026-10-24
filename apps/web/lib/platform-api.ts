/**
 * Client for the platform console API (/api/platform-console). Every write carries the console
 * header and an Idempotency-Key; a 401 means the platform session ended.
 */

export class ConsoleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Request reference to quote to support (the API's x-request-id). */
    readonly reference: string | null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'ConsoleApiError';
  }
}

export type PlatformMe = {
  id: string;
  email: string;
  name: string | null;
  roleKey: string;
  roleName: string;
  capabilities: string[];
};

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function consoleRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: { idempotencyKey?: string | null; raw?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'X-Platform-Console': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && options.idempotencyKey !== null)
    headers['Idempotency-Key'] = options.idempotencyKey ?? newKey();
  const response = await fetch(`/api/platform-console${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = 'Something went wrong. Nothing was changed.';
    let code: string | null = null;
    try {
      const data = (await response.json()) as { message?: string | string[]; code?: string };
      if (data.message)
        message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
      code = data.code ?? null;
    } catch {
      /* keep the generic message */
    }
    throw new ConsoleApiError(message, response.status, response.headers.get('x-request-id'), code);
  }
  if (options.raw) return (await response.text()) as T;
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const consoleGet = <T>(path: string) => consoleRequest<T>('GET', path);
export const consolePost = <T>(path: string, body: unknown = {}) =>
  consoleRequest<T>('POST', path, body);
export const consolePatch = <T>(path: string, body: unknown) =>
  consoleRequest<T>('PATCH', path, body);

export type LifecycleState =
  'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'ARCHIVED';

export const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
};

export const LIFECYCLE_TONE: Record<
  LifecycleState,
  'info' | 'success' | 'warning' | 'danger' | 'muted'
> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  SUSPENDED: 'danger',
  CANCELLED: 'danger',
  ARCHIVED: 'muted',
};

export const MODE_LABELS = { CLOCK: 'Clock PMS', MUST_SOURCE: 'MUST (built-in)' } as const;
export type HotelMode = keyof typeof MODE_LABELS;

export type HotelRow = {
  id: string;
  name: string;
  lifecycleState: LifecycleState;
  ownerEmail: string | null;
  ownerPending: boolean;
  mode: HotelMode;
  country: string | null;
  planName: string;
  propertyCount: number;
  staffCount: number;
  bookingCount: number;
  lastBookingAt: string | null;
  createdAt: string;
  health: null;
};

export type HotelDirectory = {
  items: HotelRow[];
  total: number;
  page: number;
  pageSize: number;
  lifecycleCounts: Record<LifecycleState, number>;
};

export type ChecklistItem = {
  key: string;
  label: string;
  state: 'done' | 'todo';
  evidence: string;
  fixHref: string;
};

export type HotelDetail = {
  id: string;
  name: string;
  lifecycle: {
    state: LifecycleState;
    label: string;
    reason: string | null;
    changedAt: string | null;
    version: number;
    allowedTransitions: LifecycleState[];
    history: Array<{
      id: string;
      from: LifecycleState | null;
      to: LifecycleState;
      reason: string;
      actorEmail: string | null;
      createdAt: string;
    }>;
  };
  mode: HotelMode;
  country: string | null;
  timeZone: string | null;
  currency: string | null;
  createdAt: string;
  owner: { email: string; name: string | null; since: string } | null;
  ownerInvite: { email: string; invitedAt: string | null } | null;
  contacts: Array<{
    id: string;
    name: string;
    address: string | null;
    timezone: string | null;
    phone: string | null;
    supportEmail: string | null;
  }>;
  counts: {
    properties: number;
    staff: number;
    bookings: number;
    bookingsLast30Days: number;
    rooms: number;
    roomTypes: number;
  };
  plan: {
    name: string;
    maxProperties: number;
    maxStaffSeats: number;
    pmsEnabled: boolean;
    note: string;
  };
};

export type ConnectionRow = {
  id: string;
  kind: 'PAYMENT' | 'PMS';
  provider: string;
  name: string;
  status: 'PENDING' | 'CONNECTED' | 'FAILED';
  lastTestedAt: string | null;
  lastTestResult: string | null;
  lastWebhookReceivedAt: string | null;
};

export type HotelConnections = {
  mode: HotelMode;
  pms: ConnectionRow[];
  payments: {
    gateways: ConnectionRow[];
    properties: Array<{
      propertyId: string;
      propertyName: string;
      stripeEnabled: boolean;
      pokpayEnabled: boolean;
      payAtHotelEnabled: boolean;
    }>;
  };
  website: Array<{
    propertyId: string;
    propertyName: string;
    origin: string | null;
    pluginConnectedAt: string | null;
  }>;
  email: {
    senders: Array<{
      propertyId: string;
      propertyName: string;
      senderName: string | null;
      replyTo: string | null;
    }>;
    last30Days: { delivered: number; failed: number; queued: number };
    lastActivityAt: string | null;
  };
};

export type StaffUsage = {
  staff: Array<{
    userId: string;
    email: string;
    name: string | null;
    membership: 'OWNER' | 'ADMIN' | 'STAFF';
    roles: string[];
    suspended: boolean;
    lastLoginAt: string | null;
    joinedAt: string;
  }>;
  usage: {
    bookingsTotal: number;
    bookingsLast30Days: number;
    liveBookingsLast30Days: number;
    paymentsLast30Days: Array<{ currency: string; count: number; amount: string }>;
    limits: Array<{ key: string; label: string; used: number; limit: number }>;
    limitsNote: string;
  };
  recentHotelEvents: Array<{
    id: string;
    action: string;
    actorType: string;
    targetType: string;
    createdAt: string;
  }>;
};

export type SupportSession = {
  id: string;
  tenantId: string;
  hotelName?: string;
  kind: 'VIEW' | 'ACT';
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'DENIED';
  reason: string;
  requestedBy: { accountId: string; email: string; name: string | null };
  durationMinutes: number;
  createdAt: string;
  startsAt: string | null;
  expiresAt: string;
  approvalMethod: 'OWNER' | 'PLATFORM' | null;
  approvedBy: string | null;
  approvedAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  /** Temporary Super admin shortcut: no approval, reason or expiry. */
  direct: boolean;
  showBanner: boolean;
};

export type TeamMember = {
  id: string;
  email: string;
  name: string | null;
  roleKey: string;
  roleName: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  lastLoginAt: string | null;
  createdAt: string;
  version: number;
  invitationExpiresAt: string | null;
};

export type TeamRole = {
  id: string;
  key: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  capabilities: string[];
};

export type AuditRow = {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: 'succeeded' | 'failed' | 'denied';
  ip: string | null;
  requestId: string | null;
};
