import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
type Request = {
  id?: string;
  method?: string;
  route?: { path?: unknown };
  headers: Record<string, unknown>;
};
const storage = new AsyncLocalStorage<{ requestId: string; method: string; route: () => string }>();
/** Capture only a request reference and route template, never URL/query/body/session/device data. */
export function auditRequestContext(
  req: Request,
  res: { setHeader: (key: string, value: string) => void },
  next: () => void,
) {
  const candidate = req.id ?? req.headers['x-request-id'];
  const requestId =
    typeof candidate === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(candidate)
      ? candidate
      : randomUUID();
  res.setHeader('x-request-id', requestId);
  storage.run(
    {
      requestId,
      method: (req.method ?? 'UNKNOWN').slice(0, 12),
      route: () =>
        typeof req.route?.path === 'string' ? req.route.path.slice(0, 250) : 'Unmatched route',
    },
    next,
  );
}
export function currentAuditContext() {
  const context = storage.getStore();
  return context
    ? { requestId: context.requestId, method: context.method, route: context.route() }
    : null;
}
