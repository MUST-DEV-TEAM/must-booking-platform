export type AuditResult = 'completed' | 'failed' | 'denied' | 'pending' | 'unknown';
export type AuditSource =
  'MUST_STAFF' | 'MUST_AUTOMATION' | 'GUEST' | 'CLOCK' | 'POKPAY' | 'STRIPE' | 'PLATFORM_ADMIN';
type Definition = { title: string; result?: AuditResult; source?: AuditSource; routine?: boolean };
/** Reviewed producer meanings. Defaults apply at INSERT only, never to historical reads. */
export const AUDIT_EVENTS: Record<string, Definition> = {
  'rates.pair_changed': { title: 'Rate comparison changed', result: 'completed' },
  'rates.website_visibility_changed': {
    title: 'Rate switched on or off for the website',
    result: 'completed',
  },
  'booking.created': { title: 'Reservation created', result: 'completed' },
  'booking.updated': { title: 'Reservation updated', result: 'completed' },
  'booking.details_edited': { title: 'Guest and reservation details updated', result: 'completed' },
  'booking.details_updated': {
    title: 'Guest and reservation details updated',
    result: 'completed',
  },
  'booking.dates_amended': { title: 'Stay changed', result: 'completed' },
  'booking.room_moved': { title: 'Room moved', result: 'completed' },
  'booking.stay_status_changed': { title: 'Guest arrival status changed', result: 'completed' },
  'booking.cancelled': { title: 'Reservation cancelled', result: 'completed' },
  'booking.payment_expired': {
    title: 'Unpaid reservation hold expired',
    result: 'completed',
    source: 'MUST_AUTOMATION',
  },
  'booking.order_payment_expired': {
    title: 'Unpaid group reservation hold expired',
    result: 'completed',
    source: 'MUST_AUTOMATION',
  },
  'booking.clock_reservation_created': {
    title: 'Reservation created in Clock',
    result: 'completed',
    source: 'CLOCK',
  },
  'booking.clock_deposit_posted': {
    title: 'Payment posted to Clock',
    result: 'completed',
    source: 'CLOCK',
  },
  'payment.collection_requested': { title: 'Payment collection requested', result: 'pending' },
  'payment.checkout_ready': {
    title: 'Payment checkout ready',
    result: 'completed',
    source: 'POKPAY',
  },
  'payment.collection_unknown': {
    title: 'Payment checkout needs review',
    result: 'unknown',
    source: 'POKPAY',
  },
  'payment.link_requested': { title: 'Payment email queued', result: 'pending' },
  'payment.balance_collected': { title: 'Payment received', result: 'completed', source: 'POKPAY' },
  'payment.manual_recorded': {
    title: 'Received payment recorded',
    result: 'completed',
    source: 'MUST_STAFF',
  },
  'payment.pokpay_checkout_resent': { title: 'Payment checkout renewed', result: 'completed' },
  'payment.refunded': { title: 'Refund completed', result: 'completed' },
  'payment.refund_pending': { title: 'Refund awaiting provider confirmation', result: 'pending' },
  'payment.refund_reconciled': {
    title: 'Refund records corrected from the provider',
    result: 'completed',
  },
  'payment.refund_unknown': { title: 'Refund needs verification', result: 'unknown' },
  'payment.clock_refund_posted': {
    title: 'Refund posted to Clock',
    result: 'completed',
    source: 'CLOCK',
  },
  'booking.stay_change_requested': { title: 'Stay change requested', result: 'pending' },
  'booking.stay_change_unknown': {
    title: 'Stay change needs provider verification',
    result: 'unknown',
    source: 'CLOCK',
  },
  'booking.room_move_unknown': {
    title: 'Room move needs provider verification',
    result: 'unknown',
    source: 'CLOCK',
  },
  'membership.role_changed': { title: 'Account role changed', result: 'completed' },
  'membership.removed': { title: 'Account membership removed', result: 'completed' },
  'property_staff.assigned': { title: 'Staff property access assigned', result: 'completed' },
  'capability.override_granted': { title: 'Staff permission granted', result: 'completed' },
  'capability.override_revoked': { title: 'Staff permission revoked', result: 'completed' },
  'capability.override_cleared': {
    title: 'Staff permission override removed',
    result: 'completed',
  },
  'integration_connection.tested': { title: 'Integration connection tested', source: 'MUST_STAFF' },
  'email_transport.attempt_finished': {
    title: 'Email provider response recorded',
    source: 'MUST_AUTOMATION',
  },
  'integration_connection.created': {
    title: 'Integration connection created',
    result: 'completed',
  },
  'integration_connection.credentials_replaced': {
    title: 'Integration credentials replaced',
    result: 'completed',
  },
  'integration_connection.deleted': {
    title: 'Integration connection deleted',
    result: 'completed',
  },
  'integration_connection.enabled_for_property': {
    title: 'Integration enabled for hotel',
    result: 'completed',
  },
  'integration_connection.disabled_for_property': {
    title: 'Integration disabled for hotel',
    result: 'completed',
  },
  'request.mutation_failed': {
    title: 'Change request failed',
    result: 'failed',
    source: 'MUST_STAFF',
  },
  'request.created': { title: 'Staff approval requested', result: 'pending' },
  'request.guest_created': { title: 'Guest request received', result: 'pending', source: 'GUEST' },
  'request.decided': { title: 'Request decision recorded', result: 'completed' },
  'auth.access_denied': {
    title: 'Action blocked by permissions',
    result: 'denied',
    source: 'MUST_STAFF',
  },
  'auth.login': { title: 'Signed in', result: 'completed', source: 'MUST_STAFF' },
  'auth.logout': { title: 'Signed out', result: 'completed', source: 'MUST_STAFF' },
  'auth.password_changed': { title: 'Password changed', result: 'completed', source: 'MUST_STAFF' },
  'auth.session_revoked': { title: 'Session revoked', result: 'completed', source: 'MUST_STAFF' },
  'role.created': { title: 'Staff role created', result: 'completed' },
  'role.updated': { title: 'Staff role changed', result: 'completed' },
  'role.deleted': { title: 'Staff role removed', result: 'completed' },
  'staff.suspended': { title: 'Staff access suspended', result: 'completed' },
  'staff.reactivated': { title: 'Staff access restored', result: 'completed' },
  'email_template.draft': { title: 'Email template draft saved', result: 'completed' },
  'email_template.published': { title: 'Email template published', result: 'completed' },
  'clock_catalog.synced': {
    title: 'Clock room catalog synchronized',
    result: 'completed',
    source: 'CLOCK',
    routine: true,
  },
  'audit.exported': { title: 'Audit history exported', result: 'completed' },
  'audit.export_receipts_expired': {
    title: 'Temporary export receipts expired',
    result: 'completed',
    source: 'MUST_AUTOMATION',
    routine: true,
  },
};
export const ROUTINE_AUDIT_ACTIONS = Object.entries(AUDIT_EVENTS)
  .filter(([, d]) => d.routine)
  .map(([action]) => action);
export const AUDIT_SOURCES = [
  'MUST_STAFF',
  'MUST_AUTOMATION',
  'GUEST',
  'CLOCK',
  'POKPAY',
  'STRIPE',
  'PLATFORM_ADMIN',
] as const;
export const AUDIT_SOURCE_LABELS: Record<string, string> = {
  MUST_STAFF: 'Staff in MUST',
  MUST_AUTOMATION: 'MUST automation',
  GUEST: 'Guest',
  CLOCK: 'Clock',
  POKPAY: 'PokPay',
  STRIPE: 'Stripe',
  PLATFORM_ADMIN: 'Platform administrator',
};
export function auditTitle(action: string) {
  return AUDIT_EVENTS[action]?.title ?? action.replaceAll('_', ' ').replaceAll('.', ' - ');
}
export function operationReference(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(value) ? value : undefined;
}

export function explicitAuditResult(value: unknown): AuditResult | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  if (['completed', 'success', 'succeeded', 'successful', 'ok'].includes(normalized))
    return 'completed';
  if (['failed', 'failure', 'error'].includes(normalized)) return 'failed';
  if (['denied', 'forbidden'].includes(normalized)) return 'denied';
  if (['pending', 'queued', 'processing'].includes(normalized)) return 'pending';
  if (['unknown', 'uncertain'].includes(normalized)) return 'unknown';
  return undefined;
}
