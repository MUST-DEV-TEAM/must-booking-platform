/** Audit visibility maps actual event prefixes to existing permissions; unknowns are privileged only. */
export const AUDIT_FAMILIES = [
  {
    name: 'Reservations',
    capability: 'bookings.view',
    prefixes: ['booking.', 'bookings.', 'reservation.', 'clock_booking_consistency.'],
  },
  {
    name: 'Payments',
    capability: 'payments.view',
    prefixes: [
      'payment.',
      'payments.',
      'refund.',
      'booking.clock_deposit_',
      'clock_payment_reconciliation.',
    ],
  },
  {
    name: 'Inventory',
    capability: 'calendar.view',
    prefixes: ['inventory_', 'availability_blocks.', 'room_availability.'],
  },
  {
    name: 'Rates',
    capability: 'rates.manage',
    prefixes: ['pricing.', 'rate_plan.', 'rate_rule.', 'cancellation_policy.'],
  },
  {
    name: 'Accommodation',
    capability: 'accommodations.manage',
    prefixes: [
      'room.',
      'room_type.',
      'room_category.',
      'room_type_image.',
      'room_type_images.',
      'room_image.',
      'room_images.',
      'accommodation.',
      'amenity.',
    ],
  },
  { name: 'Guests', capability: 'guests.view', prefixes: ['guest.'] },
  { name: 'Reports', capability: 'reports.view', prefixes: ['report.', 'report_view.'] },
  {
    name: 'Emails',
    capability: 'settings.manage',
    prefixes: ['email.', 'email_', 'notification_settings.'],
  },
  {
    name: 'Settings and providers',
    capability: 'settings.manage',
    prefixes: [
      'property.',
      'properties.',
      'integration.',
      'integration_',
      'connection.',
      'clock_catalog.',
      'clock_catalog_mapping.',
    ],
  },
  {
    name: 'Access and security',
    capability: 'staff.view',
    prefixes: ['staff.', 'role.', 'membership.', 'capability.', 'property_staff.', 'auth.'],
  },
] as const;
export const PHOTO_PREFIXES = [
  'room_image.',
  'room_images.',
  'room_type_image.',
  'room_type_images.',
];
export const AUDIT_CRITICAL_PATTERN = String.raw`^(staff\.|role\.|membership\.|capability\.|property_staff\.|integration[._]|connection\.|clock_catalog_mapping\.|audit\.exported|auth\.password_changed|auth\.session_revoked|refund\.)|^(payment|refund).*refund`;
const forbidden =
  /password|secret|credential|token|authorization|cookie|session|private.?key|api.?key|access.?key|auth.?header|signature|\bip\b|ip.?address|remote.?(address|ip)|client.?ip|location|latitude|longitude/i;
const identity =
  /actor|user.?id|user.?name|staff|member|created.?by|updated.?by|assigned.?by|first.?name|last.?name|full.?name|e.?mail|phone|owner.?id|approved.?by/i;
export function auditText(value: string, redactions: readonly string[] = []) {
  let text = value
    .slice(0, 10000)
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '[credential redacted]')
    .replace(/(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/g, '[credential redacted]')
    .replace(/(?:password|api[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '[credential redacted]');
  for (const item of redactions.filter((s) => s.trim().length >= 3))
    text = text.split(item).join('[identity hidden]');
  return text;
}
/** Sanitized recorded evidence only; no invented snapshots or integrity claims. */
export function safeAuditValue(
  value: unknown,
  canViewActors: boolean,
  redactions: readonly string[] = [],
  depth = 0,
): unknown {
  if (depth > 8) return '[nested evidence omitted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return auditText(value, redactions);
  if (Array.isArray(value))
    return value.slice(0, 200).map((v) => safeAuditValue(v, canViewActors, redactions, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !forbidden.test(key) && (canViewActors || !identity.test(key)))
        .slice(0, 100)
        .map(([key, v]) => [key, safeAuditValue(v, canViewActors, redactions, depth + 1)]),
    );
  return null;
}
/** Neutralize formulas even when a spreadsheet strips leading control/whitespace characters. */
export function auditCsv(rows: readonly (readonly unknown[])[]) {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    let index = 0;
    while (
      index < text.length &&
      (text.charCodeAt(index) <= 32 || text.charCodeAt(index) === 127 || /\s/u.test(text[index]))
    )
      index++;
    const safe = index < text.length && '=+@-'.includes(text[index]) ? "'" + text : text;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
