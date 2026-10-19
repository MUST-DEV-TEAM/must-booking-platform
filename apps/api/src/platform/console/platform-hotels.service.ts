import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PropertyRoleTemplatesService } from '../../tenancy/property-role-templates.service';
import { StaffInviteService } from '../../tenancy/staff-invite.service';
import { TenantDatabaseService, type TenantTransaction } from '../../tenancy/tenant-database.service';
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_TRANSITIONS,
  needsDangerousPermission,
  type LifecycleState,
} from './hotel-lifecycle';
import { PlatformAuditService } from './platform-audit.service';
import { emailPattern } from './platform-auth.service';
import { requireActor, type PlatformRequestContext } from './platform-console.decorators';
import { PlatformLifecycleService } from './platform-lifecycle.service';

export type HotelMode = 'CLOCK' | 'MUST_SOURCE';

export interface HotelDirectoryRow {
  id: string;
  name: string;
  lifecycleState: LifecycleState;
  /** The owner, or the invited address while the invitation is still pending. */
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
  /** Health scoring is Phase 2: always null for now. */
  health: null;
}

export interface HotelDirectoryQuery {
  search?: string;
  lifecycle?: LifecycleState[];
  mode?: HotelMode;
  sort: 'name' | 'created' | 'lifecycle' | 'owner' | 'bookings';
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface ChecklistItem {
  key:
    | 'owner_invited'
    | 'owner_accepted'
    | 'hotel_details'
    | 'mode_ready'
    | 'payment_gateway'
    | 'website'
    | 'first_booking';
  label: string;
  state: 'done' | 'todo';
  evidence: string;
  fixHref: string;
}

const MODE_CLOCK_SQL = 'CLOCK_PMS';
const SUCCESS_STATUSES = ['succeeded', 'PAID'];

function slugify(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'hotel'}-${id.slice(0, 8)}`;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class PlatformHotelsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(PlatformLifecycleService) private readonly lifecycle: PlatformLifecycleService,
    @Inject(PropertyRoleTemplatesService) private readonly templates: PropertyRoleTemplatesService,
    @Inject(StaffInviteService) private readonly invites: StaffInviteService,
  ) {}

  // ---- directory ----------------------------------------------------------------------------

  async list(query: HotelDirectoryQuery) {
    const [organizations, facts] = await Promise.all([
      this.database.withPlatformAdminTransaction({ role: 'platform_admin' }, (tx) =>
        tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            lifecycleState: LifecycleState;
            onboardingMode: HotelMode | null;
            country: string | null;
            createdAt: string;
            planName: string;
            ownerEmail: string | null;
            ownerPending: boolean;
          }>
        >`
          SELECT o."id", o."name", o."lifecycle_state"::text AS "lifecycleState",
            o."onboarding_mode" AS "onboardingMode", o."country", o."created_at" AS "createdAt",
            p."name" AS "planName", COALESCE(owner."email", o."owner_invited_email") AS "ownerEmail",
            (owner."email" IS NULL AND o."owner_invited_email" IS NOT NULL) AS "ownerPending"
          FROM "organizations" o
          JOIN "plans" p ON p."id" = o."plan_id"
          LEFT JOIN LATERAL (
            SELECT u."email" FROM "tenant_memberships" tm JOIN "users" u ON u."id" = tm."user_id"
            WHERE tm."tenant_id" = o."id" AND tm."role" = 'OWNER'::"TenantMembershipRole"
            ORDER BY tm."created_at" ASC LIMIT 1
          ) owner ON true
        `,
      ),
      this.database.withPlatformConsoleTransaction((tx) =>
        tx.$queryRaw<
          Array<{
            tenantId: string;
            propertyCount: number;
            staffCount: number;
            hasClock: boolean;
            bookingCount: number;
            lastBookingAt: string | null;
          }>
        >`SELECT * FROM "console_hotel_facts"()`,
      ),
    ]);
    const factsById = new Map(facts.map((row) => [row.tenantId, row]));
    let rows: HotelDirectoryRow[] = organizations.map((org) => {
      const fact = factsById.get(org.id);
      return {
        id: org.id,
        name: org.name,
        lifecycleState: org.lifecycleState,
        ownerEmail: org.ownerEmail,
        ownerPending: org.ownerPending,
        mode: org.onboardingMode ?? (fact?.hasClock ? 'CLOCK' : 'MUST_SOURCE'),
        country: org.country?.trim() || null,
        planName: org.planName,
        propertyCount: fact?.propertyCount ?? 0,
        staffCount: fact?.staffCount ?? 0,
        bookingCount: fact?.bookingCount ?? 0,
        lastBookingAt: fact?.lastBookingAt ?? null,
        createdAt: org.createdAt,
        health: null,
      };
    });

    const needle = query.search?.trim().toLowerCase();
    if (needle)
      rows = rows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          (row.ownerEmail ?? '').toLowerCase().includes(needle),
      );
    if (query.lifecycle?.length)
      rows = rows.filter((row) => query.lifecycle!.includes(row.lifecycleState));
    if (query.mode) rows = rows.filter((row) => row.mode === query.mode);

    const direction = query.direction === 'asc' ? 1 : -1;
    const key: Record<HotelDirectoryQuery['sort'], (row: HotelDirectoryRow) => string | number> = {
      name: (row) => row.name.toLowerCase(),
      created: (row) => row.createdAt,
      lifecycle: (row) => row.lifecycleState,
      owner: (row) => (row.ownerEmail ?? '').toLowerCase(),
      bookings: (row) => row.bookingCount,
    };
    rows.sort((a, b) => {
      const left = key[query.sort](a);
      const right = key[query.sort](b);
      return (left < right ? -1 : left > right ? 1 : a.name.localeCompare(b.name)) * direction;
    });

    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    const counts = Object.fromEntries(
      (['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'ARCHIVED'] as const).map(
        (state) => [state, organizations.filter((org) => org.lifecycleState === state).length],
      ),
    );
    return {
      items: rows.slice(start, start + query.pageSize),
      total,
      page: query.page,
      pageSize: query.pageSize,
      lifecycleCounts: counts,
    };
  }

  // ---- detail: overview and lifecycle -------------------------------------------------------

  async get(tenantId: string, capabilities: readonly string[]) {
    const detail = await this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const orgs = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          lifecycleState: LifecycleState;
          lifecycleReason: string | null;
          lifecycleChangedAt: string | null;
          lifecycleVersion: number;
          country: string | null;
          timeZone: string | null;
          currency: string | null;
          onboardingMode: HotelMode | null;
          ownerInvitedEmail: string | null;
          ownerInvitedAt: string | null;
          createdAt: string;
          planName: string;
          maxProperties: number;
          maxStaffSeats: number;
          pmsEnabled: boolean;
        }>
      >`
        SELECT o."id", o."name", o."lifecycle_state"::text AS "lifecycleState",
          o."lifecycle_reason" AS "lifecycleReason", o."lifecycle_changed_at" AS "lifecycleChangedAt",
          o."lifecycle_version" AS "lifecycleVersion", o."country", o."time_zone" AS "timeZone",
          o."currency", o."onboarding_mode" AS "onboardingMode",
          o."owner_invited_email" AS "ownerInvitedEmail", o."owner_invited_at" AS "ownerInvitedAt",
          o."created_at" AS "createdAt", p."name" AS "planName", p."max_properties" AS "maxProperties",
          p."max_staff_seats" AS "maxStaffSeats", p."pms_enabled" AS "pmsEnabled"
        FROM "organizations" o JOIN "plans" p ON p."id" = o."plan_id"
        WHERE o."id" = ${tenantId}::uuid
      `;
      const org = orgs[0];
      if (!org) throw new NotFoundException('Hotel not found.');
      const [owner, properties, counts, clock] = await Promise.all([
        tx.$queryRaw<
          Array<{ userId: string; email: string; name: string | null; since: string }>
        >`
          SELECT u."id" AS "userId", u."email",
            NULLIF(BTRIM(CONCAT_WS(' ', u."first_name", u."last_name")), '') AS "name",
            tm."created_at" AS "since"
          FROM "tenant_memberships" tm JOIN "users" u ON u."id" = tm."user_id"
          WHERE tm."tenant_id" = ${tenantId}::uuid AND tm."role" = 'OWNER'::"TenantMembershipRole"
          ORDER BY tm."created_at" ASC LIMIT 1
        `,
        tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            address: string | null;
            timezone: string | null;
            phone: string | null;
            supportEmail: string | null;
          }>
        >`
          SELECT "id", "name", "address", "timezone", "phone", "support_email" AS "supportEmail"
          FROM "properties" ORDER BY "created_at", "name"
        `,
        tx.$queryRaw<
          [{ staff: number; bookings: number; bookings30: number; rooms: number; roomTypes: number }]
        >`
          SELECT
            (SELECT COUNT(*)::int FROM "tenant_memberships") AS "staff",
            (SELECT COUNT(*)::int FROM "bookings") AS "bookings",
            (SELECT COUNT(*)::int FROM "bookings" WHERE "created_at" >= now() - interval '30 days') AS "bookings30",
            (SELECT COUNT(*)::int FROM "rooms") AS "rooms",
            (SELECT COUNT(*)::int FROM "room_types") AS "roomTypes"
        `,
        tx.$queryRaw<Array<{ found: number }>>`
          SELECT 1 AS "found" FROM "integration_connections" WHERE "provider" = ${MODE_CLOCK_SQL}::"IntegrationProvider" LIMIT 1
        `,
      ]);
      return { org, owner: owner[0] ?? null, properties, counts: counts[0], hasClock: clock.length > 0 };
    });

    const { org } = detail;
    const mode: HotelMode = org.onboardingMode ?? (detail.hasClock ? 'CLOCK' : 'MUST_SOURCE');
    const allowed = LIFECYCLE_TRANSITIONS[org.lifecycleState].filter(
      (to) =>
        capabilities.includes('platform.hotels.lifecycle') &&
        (!needsDangerousPermission(org.lifecycleState, to) ||
          capabilities.includes('platform.hotels.dangerous')),
    );
    return {
      id: org.id,
      name: org.name,
      lifecycle: {
        state: org.lifecycleState,
        label: LIFECYCLE_LABELS[org.lifecycleState],
        reason: org.lifecycleReason,
        changedAt: org.lifecycleChangedAt,
        version: org.lifecycleVersion,
        allowedTransitions: allowed,
        history: await this.lifecycle.history(tenantId),
      },
      mode,
      country: org.country?.trim() ?? null,
      timeZone: org.timeZone,
      currency: org.currency?.trim() ?? null,
      createdAt: org.createdAt,
      owner: detail.owner
        ? { email: detail.owner.email, name: detail.owner.name, since: detail.owner.since }
        : null,
      ownerInvite: org.ownerInvitedEmail
        ? { email: org.ownerInvitedEmail, invitedAt: org.ownerInvitedAt }
        : null,
      contacts: detail.properties,
      counts: {
        properties: detail.properties.length,
        staff: detail.counts?.staff ?? 0,
        bookings: detail.counts?.bookings ?? 0,
        bookingsLast30Days: detail.counts?.bookings30 ?? 0,
        rooms: detail.counts?.rooms ?? 0,
        roomTypes: detail.counts?.roomTypes ?? 0,
      },
      plan: {
        name: org.planName,
        maxProperties: org.maxProperties,
        maxStaffSeats: org.maxStaffSeats,
        pmsEnabled: org.pmsEnabled,
        note: 'Plan and billing are managed in Milestone 15; this is read-only.',
      },
    };
  }

  // ---- detail: connections (status only, never secrets) -------------------------------------

  async connections(tenantId: string) {
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      await this.requireHotel(tx, tenantId);
      const [connections, properties, email, clock] = await Promise.all([
        tx.$queryRaw<
          Array<{
            id: string;
            kind: 'PAYMENT' | 'PMS';
            provider: string;
            name: string;
            status: 'PENDING' | 'CONNECTED' | 'FAILED';
            lastTestedAt: string | null;
            lastTestResult: string | null;
            lastWebhookReceivedAt: string | null;
            createdAt: string;
          }>
        >`
          SELECT "id", "kind"::text AS "kind", "provider"::text AS "provider", "name",
            "status"::text AS "status", "last_tested_at" AS "lastTestedAt",
            "last_test_result" AS "lastTestResult",
            "last_webhook_received_at" AS "lastWebhookReceivedAt", "created_at" AS "createdAt"
          FROM "integration_connections" ORDER BY "created_at"
        `,
        tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            stripeEnabled: boolean;
            pokpayEnabled: boolean;
            payAtHotelEnabled: boolean;
            websiteOrigin: string | null;
            wordpressConnectedAt: string | null;
            emailSenderName: string | null;
            emailReplyTo: string | null;
            supportEmail: string | null;
          }>
        >`
          SELECT "id", "name", "stripe_enabled" AS "stripeEnabled", "pokpay_enabled" AS "pokpayEnabled",
            "pay_at_hotel_enabled" AS "payAtHotelEnabled", "public_website_origin" AS "websiteOrigin",
            "wordpress_connected_at" AS "wordpressConnectedAt", "email_sender_name" AS "emailSenderName",
            "email_reply_to" AS "emailReplyTo", "support_email" AS "supportEmail"
          FROM "properties" ORDER BY "created_at", "name"
        `,
        tx.$queryRaw<Array<{ status: string; count: number; lastAt: string | null }>>`
          SELECT "status"::text AS "status", COUNT(*)::int AS "count", MAX("created_at") AS "lastAt"
          FROM "email_messages"
          WHERE "created_at" >= now() - interval '30 days'
          GROUP BY "status"
        `,
        tx.$queryRaw<Array<{ found: number }>>`
          SELECT 1 AS "found" FROM "integration_connections" WHERE "provider" = ${MODE_CLOCK_SQL}::"IntegrationProvider" LIMIT 1
        `,
      ]);
      const orgMode = await tx.$queryRaw<Array<{ mode: HotelMode | null }>>`
        SELECT "onboarding_mode" AS "mode" FROM "organizations" WHERE "id" = ${tenantId}::uuid
      `;
      const byStatus = Object.fromEntries(email.map((row) => [row.status, row.count]));
      const sentOrDelivered = (byStatus.SENT ?? 0) + (byStatus.DELIVERED ?? 0);
      const failed = (byStatus.FAILED ?? 0) + (byStatus.BOUNCED ?? 0) + (byStatus.COMPLAINED ?? 0);
      return {
        mode: orgMode[0]?.mode ?? (clock.length ? 'CLOCK' : 'MUST_SOURCE'),
        pms: connections.filter((row) => row.kind === 'PMS'),
        payments: {
          gateways: connections.filter((row) => row.kind === 'PAYMENT'),
          properties: properties.map((row) => ({
            propertyId: row.id,
            propertyName: row.name,
            stripeEnabled: row.stripeEnabled,
            pokpayEnabled: row.pokpayEnabled,
            payAtHotelEnabled: row.payAtHotelEnabled,
          })),
        },
        website: properties.map((row) => ({
          propertyId: row.id,
          propertyName: row.name,
          origin: row.websiteOrigin,
          pluginConnectedAt: row.wordpressConnectedAt,
        })),
        email: {
          senders: properties.map((row) => ({
            propertyId: row.id,
            propertyName: row.name,
            senderName: row.emailSenderName,
            replyTo: row.emailReplyTo ?? row.supportEmail,
          })),
          last30Days: { delivered: sentOrDelivered, failed, queued: byStatus.QUEUED ?? 0 },
          lastActivityAt: email.map((row) => row.lastAt).filter(Boolean).sort().pop() ?? null,
        },
      };
    });
  }

  // ---- detail: staff and usage --------------------------------------------------------------

  async staffUsage(tenantId: string) {
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const orgs = await tx.$queryRaw<
        Array<{ maxProperties: number; maxStaffSeats: number }>
      >`
        SELECT p."max_properties" AS "maxProperties", p."max_staff_seats" AS "maxStaffSeats"
        FROM "organizations" o JOIN "plans" p ON p."id" = o."plan_id" WHERE o."id" = ${tenantId}::uuid
      `;
      if (!orgs[0]) throw new NotFoundException('Hotel not found.');
      const [staff, usage, payments, recent] = await Promise.all([
        tx.$queryRaw<
          Array<{
            userId: string;
            email: string;
            name: string | null;
            membership: 'OWNER' | 'ADMIN' | 'STAFF';
            roles: string[];
            suspended: boolean;
            lastLoginAt: string | null;
            joinedAt: string;
          }>
        >`
          SELECT u."id" AS "userId", u."email",
            NULLIF(BTRIM(CONCAT_WS(' ', u."first_name", u."last_name")), '') AS "name",
            tm."role"::text AS "membership",
            COALESCE((SELECT array_agg(DISTINCT t."name") FROM "property_staff_assignments" a
              JOIN "property_role_templates" t ON t."id" = a."role_template_id"
              WHERE a."tenant_id" = tm."tenant_id" AND a."user_id" = u."id"), '{}') AS "roles",
            (EXISTS (SELECT 1 FROM "property_staff_assignments" a
              WHERE a."tenant_id" = tm."tenant_id" AND a."user_id" = u."id")
              AND NOT EXISTS (SELECT 1 FROM "property_staff_assignments" a
              WHERE a."tenant_id" = tm."tenant_id" AND a."user_id" = u."id" AND a."suspended_at" IS NULL)
              AND tm."role" = 'STAFF'::"TenantMembershipRole") AS "suspended",
            (SELECT MAX(l."created_at") FROM "audit_logs" l
              WHERE l."tenant_id" = tm."tenant_id" AND l."actor_user_id" = u."id" AND l."action" = 'auth.login') AS "lastLoginAt",
            tm."created_at" AS "joinedAt"
          FROM "tenant_memberships" tm JOIN "users" u ON u."id" = tm."user_id"
          WHERE tm."tenant_id" = ${tenantId}::uuid
          ORDER BY tm."created_at" ASC
        `,
        tx.$queryRaw<[{ bookings: number; bookings30: number; confirmed30: number; properties: number }]>`
          SELECT (SELECT COUNT(*)::int FROM "bookings") AS "bookings",
            (SELECT COUNT(*)::int FROM "bookings" WHERE "created_at" >= now() - interval '30 days') AS "bookings30",
            (SELECT COUNT(*)::int FROM "bookings" WHERE "created_at" >= now() - interval '30 days'
              AND "status"::text NOT IN ('DRAFT','QUOTED','INVENTORY_REVALIDATING','CANCELLED','EXPIRED','PAYMENT_FAILED')) AS "confirmed30",
            (SELECT COUNT(*)::int FROM "properties") AS "properties"
        `,
        tx.$queryRaw<Array<{ currency: string; count: number; amount: string }>>`
          SELECT "currency", COUNT(*)::int AS "count", SUM("amount")::text AS "amount"
          FROM "payments"
          WHERE "kind" = 'CHARGE'::"PaymentKind" AND "created_at" >= now() - interval '30 days'
            AND "status" = ANY(${SUCCESS_STATUSES})
          GROUP BY "currency" ORDER BY "currency"
        `,
        tx.$queryRaw<
          Array<{ id: string; action: string; actorType: string; targetType: string; createdAt: string }>
        >`
          SELECT "id", "action", "actor_type"::text AS "actorType", "target_type" AS "targetType",
            "created_at" AS "createdAt"
          FROM "audit_logs" WHERE "tenant_id" = ${tenantId}::uuid
          ORDER BY "created_at" DESC, "id" DESC LIMIT 10
        `,
      ]);
      const seats = staff.filter((member) => !member.suspended).length;
      return {
        staff,
        usage: {
          bookingsTotal: usage[0]?.bookings ?? 0,
          bookingsLast30Days: usage[0]?.bookings30 ?? 0,
          liveBookingsLast30Days: usage[0]?.confirmed30 ?? 0,
          paymentsLast30Days: payments,
          limits: [
            { key: 'properties', label: 'Properties', used: usage[0]?.properties ?? 0, limit: orgs[0].maxProperties },
            { key: 'staff', label: 'Staff seats', used: seats, limit: orgs[0].maxStaffSeats },
          ],
          limitsNote: 'Limits are the current plan placeholders (Milestone 15 makes them real).',
        },
        recentHotelEvents: recent,
      };
    });
  }

  // ---- onboarding checklist, computed from real data ----------------------------------------

  async onboarding(tenantId: string): Promise<{ items: ChecklistItem[]; complete: boolean }> {
    const facts = await this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const orgs = await tx.$queryRaw<
        Array<{ ownerInvitedEmail: string | null; ownerInvitedAt: string | null; mode: HotelMode | null }>
      >`
        SELECT "owner_invited_email" AS "ownerInvitedEmail", "owner_invited_at" AS "ownerInvitedAt",
          "onboarding_mode" AS "mode" FROM "organizations" WHERE "id" = ${tenantId}::uuid
      `;
      if (!orgs[0]) throw new NotFoundException('Hotel not found.');
      const [owner, property, connections, rooms, rates, bookings] = await Promise.all([
        tx.$queryRaw<Array<{ email: string; since: string }>>`
          SELECT u."email", tm."created_at" AS "since"
          FROM "tenant_memberships" tm JOIN "users" u ON u."id" = tm."user_id"
          WHERE tm."tenant_id" = ${tenantId}::uuid AND tm."role" = 'OWNER'::"TenantMembershipRole"
          ORDER BY tm."created_at" ASC LIMIT 1
        `,
        tx.$queryRaw<
          Array<{
            address: string | null;
            timezone: string | null;
            phone: string | null;
            supportEmail: string | null;
            checkIn: string | null;
            checkOut: string | null;
            websiteOrigin: string | null;
            wordpressConnectedAt: string | null;
          }>
        >`
          SELECT "address", "timezone", "phone", "support_email" AS "supportEmail",
            "check_in_time" AS "checkIn", "check_out_time" AS "checkOut",
            "public_website_origin" AS "websiteOrigin", "wordpress_connected_at" AS "wordpressConnectedAt"
          FROM "properties" ORDER BY "created_at" LIMIT 1
        `,
        tx.$queryRaw<Array<{ kind: string; provider: string; status: string }>>`
          SELECT "kind"::text AS "kind", "provider"::text AS "provider", "status"::text AS "status"
          FROM "integration_connections"
        `,
        tx.$queryRaw<[{ roomTypes: number; rooms: number }]>`
          SELECT (SELECT COUNT(*)::int FROM "room_types") AS "roomTypes", (SELECT COUNT(*)::int FROM "rooms") AS "rooms"
        `,
        tx.$queryRaw<[{ count: number }]>`SELECT COUNT(*)::int AS "count" FROM "rate_plans"`,
        tx.$queryRaw<[{ count: number; lastAt: string | null }]>`
          SELECT COUNT(*)::int AS "count", MAX("created_at") AS "lastAt" FROM "bookings"
          WHERE "status"::text NOT IN ('DRAFT','QUOTED','INVENTORY_REVALIDATING')
        `,
      ]);
      return {
        org: orgs[0],
        owner: owner[0] ?? null,
        property: property[0] ?? null,
        connections,
        rooms: rooms[0],
        rates: rates[0]?.count ?? 0,
        bookings: bookings[0],
      };
    });

    const base = `/platform/hotels/${tenantId}`;
    const hotelSettings = `/dashboard/${tenantId}/settings`;
    const prop = facts.property;
    const missing: string[] = [];
    if (!prop?.address) missing.push('address');
    if (!prop?.timezone) missing.push('time zone');
    if (!prop?.phone && !prop?.supportEmail) missing.push('phone or support email');
    if (!prop?.checkIn || !prop?.checkOut) missing.push('check-in and check-out times');

    const clockConnection = facts.connections.find((row) => row.provider === MODE_CLOCK_SQL);
    const mode: HotelMode | null = facts.org.mode ?? (clockConnection ? 'CLOCK' : null);
    let modeState: ChecklistItem['state'] = 'todo';
    let modeEvidence = 'No mode chosen yet: connect a PMS or set up rooms and rates.';
    if (mode === 'CLOCK') {
      modeState = clockConnection?.status === 'CONNECTED' ? 'done' : 'todo';
      modeEvidence = clockConnection
        ? `Clock PMS connection is ${clockConnection.status.toLowerCase()}.`
        : 'Mode is Clock but no Clock connection exists yet.';
    } else if (mode === 'MUST_SOURCE' || facts.rooms.roomTypes > 0) {
      const ready = facts.rooms.roomTypes > 0 && facts.rates > 0;
      modeState = ready ? 'done' : 'todo';
      modeEvidence = `${facts.rooms.roomTypes} room type(s), ${facts.rooms.rooms} room(s), ${facts.rates} rate plan(s).`;
    }

    const gateways = facts.connections.filter((row) => row.kind === 'PAYMENT');
    const connectedGateways = gateways.filter((row) => row.status === 'CONNECTED');
    const items: ChecklistItem[] = [
      {
        key: 'owner_invited',
        label: 'Owner invited',
        state: facts.org.ownerInvitedAt || facts.owner ? 'done' : 'todo',
        evidence: facts.org.ownerInvitedAt
          ? `Invitation sent to ${facts.org.ownerInvitedEmail}.`
          : facts.owner
            ? `${facts.owner.email} is the owner.`
            : 'No owner invitation has been sent.',
        fixHref: `${base}?tab=overview&action=invite-owner`,
      },
      {
        key: 'owner_accepted',
        label: 'Owner accepted',
        state: facts.owner ? 'done' : 'todo',
        evidence: facts.owner
          ? `${facts.owner.email} joined on ${new Date(facts.owner.since).toISOString().slice(0, 10)}.`
          : 'Waiting for the owner to accept the invitation.',
        fixHref: `${base}?tab=overview&action=invite-owner`,
      },
      {
        key: 'hotel_details',
        label: 'Hotel details complete',
        state: prop && missing.length === 0 ? 'done' : 'todo',
        evidence: prop
          ? missing.length
            ? `Missing: ${missing.join(', ')}.`
            : 'Address, time zone, contact and check-in times are set.'
          : 'The hotel has no property yet.',
        fixHref: hotelSettings,
      },
      {
        key: 'mode_ready',
        label: mode === 'CLOCK' ? 'Clock PMS connected' : 'Rooms and rates set up',
        state: modeState,
        evidence: modeEvidence,
        fixHref: mode === 'CLOCK' ? `${base}?tab=connections` : `/dashboard/${tenantId}/accommodations`,
      },
      {
        key: 'payment_gateway',
        label: 'Payment gateway connected',
        state: connectedGateways.length > 0 ? 'done' : 'todo',
        evidence: connectedGateways.length
          ? `${connectedGateways.map((row) => row.provider).join(', ')} connected.`
          : gateways.length
            ? `Gateway status: ${gateways.map((row) => `${row.provider} ${row.status.toLowerCase()}`).join(', ')}.`
            : 'No payment gateway is connected.',
        fixHref: `${base}?tab=connections`,
      },
      {
        key: 'website',
        label: 'Website connected',
        state: prop?.wordpressConnectedAt ? 'done' : 'todo',
        evidence: prop?.wordpressConnectedAt
          ? 'The booking plugin has connected.'
          : prop?.websiteOrigin
            ? `Website ${prop.websiteOrigin} is set, but the plugin has not connected yet.`
            : 'No website address and no plugin connection yet.',
        fixHref: `${base}?tab=connections`,
      },
      {
        key: 'first_booking',
        label: 'First test booking made',
        state: facts.bookings.count > 0 ? 'done' : 'todo',
        evidence:
          facts.bookings.count > 0
            ? `${facts.bookings.count} booking(s); latest ${new Date(String(facts.bookings.lastAt)).toISOString().slice(0, 10)}.`
            : 'No booking has been made yet.',
        fixHref: `/dashboard/${tenantId}/reservations`,
      },
    ];
    return { items, complete: items.every((item) => item.state === 'done') };
  }

  // ---- creating a hotel ---------------------------------------------------------------------

  async create(input: unknown, ctx: PlatformRequestContext) {
    const actor = requireActor(ctx);
    const body = (input ?? {}) as Record<string, unknown>;
    const text = (value: unknown, max: number) =>
      typeof value === 'string' ? value.trim().slice(0, max) : '';
    const hotelName = text(body.hotelName, 200);
    const ownerName = text(body.ownerName, 200);
    const ownerEmail = text(body.ownerEmail, 320).toLowerCase();
    const country = text(body.country, 20).toUpperCase();
    const timeZone = text(body.timeZone, 64);
    const currency = text(body.currency, 20).toUpperCase();
    const mode = body.mode;
    if (hotelName.length < 2) throw new BadRequestException('A hotel name is required.');
    if (ownerName.length < 2) throw new BadRequestException('The owner’s name is required.');
    if (!emailPattern.test(ownerEmail)) throw new BadRequestException('A valid owner email is required.');
    if (!/^[A-Z]{2}$/.test(country)) throw new BadRequestException('A two-letter country code is required.');
    if (!timeZone || !isValidTimeZone(timeZone)) throw new BadRequestException('A valid time zone is required.');
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('A three-letter currency code is required.');
    if (mode !== 'CLOCK' && mode !== 'MUST_SOURCE')
      throw new BadRequestException('Mode must be CLOCK or MUST_SOURCE.');

    const tenantId = randomUUID();
    const propertyId = randomUUID();
    ctx.hint.tenantId = tenantId;

    const roleTemplateId = await this.database.withConsoleTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "organizations" ("id", "name", "lifecycle_state", "lifecycle_reason", "country",
            "time_zone", "currency", "onboarding_mode", "created_by_platform_account_id")
          VALUES (${tenantId}::uuid, ${hotelName}, 'TRIAL'::"OrganizationLifecycleState",
            'Created by onboarding', ${country}, ${timeZone}, ${currency}, ${mode}, ${actor.accountId}::uuid)
        `;
        await tx.$executeRaw`
          INSERT INTO "properties" ("id", "tenant_id", "name", "slug", "timezone")
          VALUES (${propertyId}::uuid, ${tenantId}::uuid, ${hotelName}, ${slugify(hotelName, propertyId)}, ${timeZone})
        `;
        await this.templates.ensureBuiltInTemplatesInTransaction(tx, tenantId, propertyId);
        const templates = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "property_role_templates"
          WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
            AND "name" = 'Property Manager'
        `;
        await tx.$executeRaw`
          INSERT INTO "organization_lifecycle_events" ("tenant_id", "from_state", "to_state", "reason", "actor_account_id", "actor_email")
          VALUES (${tenantId}::uuid, NULL, 'TRIAL'::"OrganizationLifecycleState", 'Created by onboarding',
            ${actor.accountId}::uuid, ${actor.email})
        `;
        await this.audit.recordInTransaction(tx, ctx, {
          action: 'platform.hotel.created',
          tenantId,
          propertyId,
          targetType: 'organization',
          targetId: tenantId,
          after: { name: hotelName, country, timeZone, currency, mode, lifecycle: 'TRIAL', ownerEmail },
          details: { ownerName },
        });
        if (!templates[0]) throw new ConflictException('Could not create the hotel roles.');
        return templates[0].id;
      },
    );

    await this.sendOwnerInvitation(tenantId, propertyId, roleTemplateId, ownerEmail, ctx);
    return { tenantId, propertyId, ownerInvited: true };
  }

  /** (Re)invites the hotel owner through the existing staff invitation service. */
  async inviteOwner(tenantId: string, input: unknown, ctx: PlatformRequestContext) {
    const body = (input ?? {}) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!emailPattern.test(email)) throw new BadRequestException('A valid owner email is required.');
    const target = await this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      await this.requireHotel(tx, tenantId);
      const owner = await tx.$queryRaw<Array<{ found: number }>>`
        SELECT 1 AS "found" FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "role" = 'OWNER'::"TenantMembershipRole" LIMIT 1
      `;
      if (owner.length) throw new ConflictException('This hotel already has an owner.');
      const property = await tx.$queryRaw<Array<{ propertyId: string; roleTemplateId: string }>>`
        SELECT p."id" AS "propertyId", t."id" AS "roleTemplateId"
        FROM "properties" p JOIN "property_role_templates" t
          ON t."tenant_id" = p."tenant_id" AND t."property_id" = p."id" AND t."name" = 'Property Manager'
        ORDER BY p."created_at" LIMIT 1
      `;
      if (!property[0]) throw new ConflictException('The hotel has no property to assign the owner to.');
      return property[0];
    });
    ctx.hint.tenantId = tenantId;
    await this.sendOwnerInvitation(tenantId, target.propertyId, target.roleTemplateId, email, ctx);
    return { ownerInvited: true };
  }

  private async sendOwnerInvitation(
    tenantId: string,
    propertyId: string,
    roleTemplateId: string,
    email: string,
    ctx: PlatformRequestContext,
  ): Promise<void> {
    const actor = requireActor(ctx);
    await this.invites.invite(
      {
        tenantId,
        email,
        membershipRole: 'OWNER',
        assignments: [{ propertyId, roleTemplateId }],
      },
      actor.accountId,
      { email: actor.email, type: 'PLATFORM_ADMIN' },
    );
    await this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      await tx.$executeRaw`
        UPDATE "organizations" SET "owner_invited_email" = ${email}, "owner_invited_at" = now()
        WHERE "id" = ${tenantId}::uuid
      `;
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.hotel.owner_invited',
        tenantId,
        targetType: 'organization',
        targetId: tenantId,
        after: { ownerEmail: email },
      });
    });
  }

  private async requireHotel(tx: TenantTransaction, tenantId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "organizations" WHERE "id" = ${tenantId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Hotel not found.');
  }
}
