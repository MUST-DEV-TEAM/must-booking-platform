import { createHmac, timingSafeEqual } from 'node:crypto';

type Scope = { tenantId: string; propertyId: string; bookingId: string; dueAt: string };

function sign(payload: string): string {
  const secret = process.env.QUOTE_SIGNING_SECRET;
  if (!secret && process.env.NODE_ENV === 'production')
    throw new Error('QUOTE_SIGNING_SECRET is required for payment links.');
  return createHmac('sha256', secret ?? 'must-booking-local-request-payment')
    .update(`request-payment:${payload}`)
    .digest('base64url');
}

export function requestPaymentLink(scope: Scope): string {
  const payload = Buffer.from(JSON.stringify(scope)).toString('base64url');
  const path = `/api/tenants/${scope.tenantId}/properties/${scope.propertyId}/bookings/${scope.bookingId}/request-payment`;
  const url = new URL(path, process.env.WEB_APP_URL ?? 'http://localhost:3001');
  url.searchParams.set('token', `${payload}.${sign(payload)}`);
  return url.toString();
}

export function verifyRequestPaymentLink(token: string, scope: Scope): boolean {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = Buffer.from(sign(payload)),
    actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Scope;
    return (
      parsed.tenantId === scope.tenantId &&
      parsed.propertyId === scope.propertyId &&
      parsed.bookingId === scope.bookingId &&
      parsed.dueAt === scope.dueAt
    );
  } catch {
    return false;
  }
}
