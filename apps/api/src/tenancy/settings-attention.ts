import { BadRequestException } from '@nestjs/common';
import type { TenantDatabaseService } from './tenant-database.service';

/**
 * Settings overview, "Needs attention" (settings redesign plan, tab 1): live problems that need a person, each
 * with the place that fixes it. Worked out on the server from saved data only; nothing is guessed. The form
 * problems of each tab come from the readiness steps; these are the problems outside the forms.
 */
export type SettingsAttentionLink =
  | { tab: 'integrations' | 'payment-methods' | 'emails' }
  | { section: 'overview'; extra: 'tab=needs-attention' };
export type SettingsAttentionItem = {
  key: string;
  label: string;
  note: string;
  link: SettingsAttentionLink;
};
export type SettingsOverviewHidden = { setupGuide: boolean; readyNotice: boolean };

type Scope = { tenantId: string; propertyId: string };

/** No Clock event for this long means its subscription is likely broken (the same rule as ClockWebhookHealthService). */
const CLOCK_WEBHOOK_STALE_HOURS = 48;
/** An email still queued after this long is stuck, not just waiting its turn. */
const EMAIL_STUCK_MINUTES = 30;

const PROVIDER_NAMES: Record<string, string> = {
  CLOCK_PMS: 'Clock PMS',
  STRIPE: 'Stripe',
  POKPAY: 'PokPay',
};
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export async function settingsOverviewExtras(
  database: TenantDatabaseService,
  scope: Scope,
  userId: string,
): Promise<{
  emailProviderActive: boolean;
  attention: SettingsAttentionItem[];
  hidden: SettingsOverviewHidden;
}> {
  return database.withTenantTransaction(scope, async (tx) => {
    const [facts] = await tx.$queryRaw<
      Array<{
        emailProviderActive: boolean;
        pendingRequests: number;
        pendingRefunds: number;
        currencyConflicts: number;
        failedEmails: number;
        stuckEmails: number;
      }>
    >`SELECT
        EXISTS(SELECT 1 FROM email_sending_profiles WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND active_mode<>'DEFAULT') AS "emailProviderActive",
        (SELECT count(*)::int FROM booking_requests WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND type='cancellation' AND status='Pending') AS "pendingRequests",
        (SELECT count(*)::int FROM payments WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND kind='REFUND' AND status='REFUND_PENDING') AS "pendingRefunds",
        (SELECT count(*)::int FROM manual_review_items WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND category='CURRENCY_MISMATCH' AND status='OPEN') AS "currencyConflicts",
        (SELECT count(*)::int FROM email_messages WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND event_type NOT IN ('template.test','sender.test') AND created_at>=now()-interval '7 days' AND status IN ('FAILED','BOUNCED','COMPLAINED')) AS "failedEmails",
        (SELECT count(*)::int FROM email_messages WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND status='QUEUED' AND created_at<now()-make_interval(mins=>${EMAIL_STUCK_MINUTES}::int)) AS "stuckEmails"`;
    const connections = await tx.$queryRaw<
      Array<{
        kind: string;
        provider: string;
        status: string;
        mode: string | null;
        offeredToGuests: boolean;
        webhookStale: boolean;
      }>
    >`SELECT ic.kind::text AS kind, ic.provider::text AS provider, ic.status::text AS status, ic.mode,
        CASE ic.provider::text WHEN 'STRIPE' THEN p.stripe_enabled WHEN 'POKPAY' THEN p.pokpay_enabled ELSE false END AS "offeredToGuests",
        (ic.provider::text='CLOCK_PMS' AND ic.status='CONNECTED'
          AND COALESCE(ic.last_webhook_received_at, ic.created_at) < now()-make_interval(hours=>${CLOCK_WEBHOOK_STALE_HOURS}::int)) AS "webhookStale"
      FROM property_integration_connections pic
      JOIN integration_connections ic ON ic.tenant_id=pic.tenant_id AND ic.id=pic.connection_id
      JOIN properties p ON p.tenant_id=pic.tenant_id AND p.id=pic.property_id
      WHERE pic.tenant_id=${scope.tenantId}::uuid AND pic.property_id=${scope.propertyId}::uuid AND pic.enabled
      ORDER BY ic.provider::text`;
    const dismissals = await tx.$queryRaw<Array<{ kind: string }>>`
      SELECT kind FROM settings_overview_dismissals
      WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND user_id=${userId}::uuid`;

    const attention: SettingsAttentionItem[] = [];
    for (const connection of connections) {
      const name = PROVIDER_NAMES[connection.provider] ?? connection.provider;
      const tab = connection.kind === 'PAYMENT' ? 'payment-methods' : 'integrations';
      if (connection.status === 'FAILED')
        attention.push({
          key: `connection-failed:${connection.provider}`,
          label: `${name} is not working`,
          note: 'Its last connection test failed. Check the details and test it again.',
          link: { tab },
        });
      if (connection.webhookStale)
        attention.push({
          key: `webhook-missing:${connection.provider}`,
          label: `No updates from ${name} for ${CLOCK_WEBHOOK_STALE_HOURS} hours`,
          note: 'Changes made in the PMS may not reach MUST. Check the live updates in its integration.',
          link: { tab: 'integrations' },
        });
      if (connection.kind === 'PAYMENT' && connection.offeredToGuests && connection.mode === 'TEST')
        attention.push({
          key: `payments-test:${connection.provider}`,
          label: `${name} is in Test mode`,
          note: 'Guests cannot really pay online. Add your live keys before taking real bookings.',
          link: { tab: 'payment-methods' },
        });
    }
    if (facts!.pendingRequests)
      attention.push({
        key: 'cancellation-requests',
        label: `${plural(facts!.pendingRequests, 'cancellation request waits', 'cancellation requests wait')} for a decision`,
        note: 'A guest or staff member asked to cancel; approve or decline it, with its refund.',
        link: { section: 'overview', extra: 'tab=needs-attention' },
      });
    if (facts!.pendingRefunds)
      attention.push({
        key: 'refunds-pending',
        label: `${plural(facts!.pendingRefunds, 'refund is', 'refunds are')} not finished yet`,
        note: 'The payment provider has not confirmed them. Check them before telling the guest.',
        link: { section: 'overview', extra: 'tab=needs-attention' },
      });
    if (facts!.currencyConflicts)
      attention.push({
        key: 'currency-conflict',
        label: 'Currency differs from your PMS',
        note: `${plural(facts!.currencyConflicts, 'booking is', 'bookings are')} billed in another currency than MUST stores. Their amounts are not trusted until fixed.`,
        link: { section: 'overview', extra: 'tab=needs-attention' },
      });
    if (facts!.failedEmails)
      attention.push({
        key: 'email-failed',
        label: `${plural(facts!.failedEmails, 'email', 'emails')} not delivered in the last 7 days`,
        note: 'They failed, bounced or were marked as spam. Open the email activity to see why.',
        link: { tab: 'emails' },
      });
    if (facts!.stuckEmails)
      attention.push({
        key: 'email-stuck',
        label: `${plural(facts!.stuckEmails, 'email is', 'emails are')} waiting to be sent`,
        note: `Queued for more than ${EMAIL_STUCK_MINUTES} minutes. Check the sending setup.`,
        link: { tab: 'emails' },
      });

    const kinds = new Set(dismissals.map((row) => row.kind));
    return {
      emailProviderActive: facts!.emailProviderActive,
      attention,
      hidden: { setupGuide: kinds.has('SETUP_GUIDE'), readyNotice: kinds.has('READY_NOTICE') },
    };
  });
}

const HIDDEN_KINDS = { setupGuide: 'SETUP_GUIDE', readyNotice: 'READY_NOTICE' } as const;

/** Saves "Hide for now" / "Got it" for one person; `false` brings the setup guide back. */
export async function saveSettingsOverviewHidden(
  database: TenantDatabaseService,
  scope: Scope,
  userId: string,
  input: unknown,
): Promise<SettingsOverviewHidden> {
  const value = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const changes = Object.entries(HIDDEN_KINDS).filter(([field]) => Object.hasOwn(value, field));
  if (
    !changes.length ||
    Object.keys(value).some((field) => !Object.hasOwn(HIDDEN_KINDS, field)) ||
    changes.some(([field]) => typeof value[field] !== 'boolean')
  )
    throw new BadRequestException('Send setupGuide and/or readyNotice as true or false.');
  return database.withTenantTransaction(scope, async (tx) => {
    for (const [field, kind] of changes) {
      if (value[field])
        await tx.$executeRaw`INSERT INTO settings_overview_dismissals(tenant_id,property_id,user_id,kind)
          VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${userId}::uuid,${kind})
          ON CONFLICT DO NOTHING`;
      else
        await tx.$executeRaw`DELETE FROM settings_overview_dismissals
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
            AND user_id=${userId}::uuid AND kind=${kind}`;
    }
    const rows = await tx.$queryRaw<Array<{ kind: string }>>`
      SELECT kind FROM settings_overview_dismissals
      WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND user_id=${userId}::uuid`;
    const kinds = new Set(rows.map((row) => row.kind));
    return { setupGuide: kinds.has('SETUP_GUIDE'), readyNotice: kinds.has('READY_NOTICE') };
  });
}
