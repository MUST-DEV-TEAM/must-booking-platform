export type AuditEvent = {
  id: string;
  action: string;
  family: string;
  result: string;
  critical: boolean;
  createdAt: string;
  actorUserId: string | null;
  actor: string;
  targetType: string;
  targetId: string | null;
  details?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestContext?: unknown;
  related?: AuditEvent[];
};
export type AuditFilters = {
  from: string;
  to: string;
  search: string;
  family: string;
  actor: string;
  target: string;
  result: string;
};
export type AuditPage = {
  items: AuditEvent[];
  page: number;
  pageSize: number;
  total: number;
  counts: { today: number; critical: number; uniqueActors: number };
  actors: { id: string; label: string }[];
  families: string[];
  canViewActors: boolean;
  canExport: boolean;
  version: number;
  through: string;
  filters: AuditFilters;
  scopeKey: string;
};
export type AuditExport = {
  csv: string;
  count: number;
  version: number;
  evidenceId: string;
  filename: string;
};
export class AuditRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public reference: string | null,
  ) {
    super(message);
  }
}
export async function auditRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!r.ok) {
    const value = (await r.json().catch(() => null)) as { message?: unknown } | null;
    throw new AuditRequestError(
      typeof value?.message === 'string' ? value.message : 'Audit request failed.',
      r.status,
      r.headers.get('x-request-id'),
    );
  }
  return r.json() as Promise<T>;
}
export function auditPage(value: unknown): AuditPage {
  const v = value as Partial<AuditPage> | null,
    count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  if (
    !v ||
    !Array.isArray(v.items) ||
    !Array.isArray(v.actors) ||
    !Array.isArray(v.families) ||
    !v.filters ||
    typeof v.filters.from !== 'string' ||
    typeof v.filters.to !== 'string' ||
    v.items.some((row) => !row || typeof row.id !== 'string' || typeof row.action !== 'string') ||
    !v.counts ||
    !count(v.total) ||
    !count(v.version) ||
    !count(v.page) ||
    !count(v.pageSize) ||
    !count(v.counts.today) ||
    !count(v.counts.critical) ||
    !count(v.counts.uniqueActors) ||
    typeof v.canExport !== 'boolean' ||
    typeof v.canViewActors !== 'boolean' ||
    typeof v.through !== 'string' ||
    typeof v.scopeKey !== 'string'
  )
    throw new AuditRequestError('Audit data is incomplete. Reload the log.', 502, null);
  return v as AuditPage;
}
/** Preserve exact export intent/key across an uncertain response; changing the scope starts a new intent. */
export function createAuditExporter() {
  let intent = '',
    key = '';
  return (url: string, body: object) => {
    const next = JSON.stringify({ url, body });
    if (next !== intent) {
      intent = next;
      key = crypto.randomUUID();
    }
    return auditRequest<AuditExport>(url, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
  };
}
export function downloadAuditCsv(file: AuditExport) {
  const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
