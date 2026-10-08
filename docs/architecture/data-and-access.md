# Data, tenancy and access

Status: **IMPLEMENTED**, with explicit exceptions and review gaps. Code inspected 2026-09-19.

## Model and scope

[Prisma schema](../../apps/api/prisma/schema.prisma) describes models; [SQL migrations](../../apps/api/prisma/migrations) are essential for RLS policies, composite foreign keys, partial indexes, SQL functions and triggers that Prisma does not fully express.

| Scope | Records |
| --- | --- |
| Global identity/catalog | `users`, `plans`; Organization's own `id` is the tenant boundary |
| Tenant | `tenant_memberships`, `capabilities`, `guests`, `integration_connections` |
| Tenant + property | Properties' children: room types/rooms/media/amenities, rates/rules/policies, inventory and blocks, bookings, payments, staff assignments/templates/overrides, notifications, Clock mappings/folios/rankings/events/manual reviews |
| Mixed audit scope | `audit_logs.tenant_id` may be null for pre-tenant authentication; property context is optional |
| Ephemeral identity/coordination | Redis sessions, verification/reset/invite/pairing tokens, rate-limit keys and BullMQ jobs |

A Guest is tenant-wide, not a login User and not a child confined to one hotel. A booking has optional guest linkage for Clock-imported records; the projection uses a left join so a missing guest does not hide the booking. Multi-room bookings share `order_reference`/`order_room_number`; there is no separate booking-order model. Guest payments reference bookings, not a guest foreign key.

Important constraints include tenant/id composite keys, `(tenant_id, idempotency_key)` for operations, `(tenant_id, external_payment_id)` for ledger deduplication, `(connection_id, event_id)` for Clock events, and tenant/property/external-booking-id uniqueness. Money is stored as `NUMERIC(12,2)` and exchanged as amount strings; some adapter computations convert integer cents through JavaScript Number, so storage precision is not a claim that every calculation avoids floating point.

Stay dates use date columns and end-exclusive departure; timestamps use UTC-aware columns, with a property's timezone stored separately. See [booking/payments](booking-and-payments.md) for inventory constraints.

## RLS and transaction context

[TenantDatabaseService](../../apps/api/src/tenancy/tenant-database.service.ts) sets `app.tenant_id` and optional `app.property_id` using transaction-local `set_config(..., true)`. Every service must enter the appropriate transaction and explicitly scope its queries; a tenant-bound request does not automatically set context on every pooled connection.

The API uses the non-superuser `must_booking_app` role. Migrations use a separate owner via `MIGRATION_DATABASE_URL`. RLS is enabled/forced on domain tables. A missing property context intentionally allows tenant-wide access where policy permits it; property-level authorization must still be enforced by guards/services.

Pre-tenant operations use narrowly defined mechanisms, not a general bypass connection: authentication SQL functions, signup provisions, expiry-candidate discovery, platform-admin SELECT carve-outs, and `withWebhookGatewayLookup` for an opaque webhook installation ID. Inspect the latest migrations for each function's privileges; do not infer effective policy from the earliest migration alone.

## Authentication and authorization

- `auth/auth.service.ts`: bcrypt password hashing, opaque Redis-backed sessions, hashed one-time reset/verification tokens with TTL and atomic consumption. Signup creates Organization, first Property, Owner membership and permanent Free-plan association.
- `auth/auth.controller.ts`: staff cookie `must_session`, HttpOnly, SameSite=Lax and environment-dependent Secure. Reset and verification are separate token flows.
- `TenantContextGuard`: checks session, membership, declared tenant scope and property existence. It does **not alone** prove a STAFF property assignment.
- `RolesGuard`: OWNER/ADMIN/STAFF role checks and platform-admin handling. Organization suspension is stored by platform administration; this guard does not enforce it.
- `CapabilitiesService.effective`: Owner/Admin receive tenant capabilities; STAFF requires a property assignment, with template grants overridden by explicit grant/revoke rows. Relevant handlers use `RequiresCapability`.
- `EmailVerificationGuard` gates decorated sensitive actions. Signup/public endpoint rate limiters are distinct services. `AuthService` also limits by target email (staff reach the API through the Next.js proxy, so client IPs are shared): 10 failed logins per 15 minutes lock that email's sign-in with a 429 until the window ends, a successful login resets the count, and password-reset and verification emails are capped at 5 per email per hour (extra requests still answer 202 but send nothing).
- `PublicTenantScopedGuard`: validates public property scope and binds a quote to an anonymous `must_guest_session` (Secure, HttpOnly, SameSite=None). A valid same-tenant staff session can supply the binding instead. The guest cookie conveys no staff role.

Top-level tenant roles are enums; property role templates and per-user capability overrides are real data models/APIs. The old design note "roles are three constants" only describes the top-level role layer, not the absence of capability configuration.

Platform admins are Users with `is_platform_admin`; database triggers prevent simultaneous tenant membership. Their allowed cross-tenant reads and targeted writes are defined by [ADR-0021](../decisions/ADR-0021-platform-admin-cross-tenant-data-access.md) and `platform/platform-admin.service.ts`. "No default PII access" must not be read as "no authorized admin endpoint can read tenant users."

## Guests, staff and integration credentials

The shared `booking/guest-matching.ts` rule reuses exact lowercased email within a tenant. Exact trimmed phone is a suspected-duplicate signal, not permission to attach by phone. `tenancy/guests.service.ts` provides staff review/dismiss/merge: choose canonical, move booking relationships and Clock mappings under transaction/locks, fill blank fields, retain a merged tombstone. [ADR-0030](../decisions/ADR-0030-guest-matching-phone-signal-and-merge.md) supersedes ADR-0015's phone-only informational rule.

Property creation provisions Front Desk, Property Manager and Finance accounts. Their generated credentials are returned at creation, and auto-provisioned memberships are excluded from staff-seat usage. Ordinary roster membership, including Owner/Admin, counts toward the cap.

`CredentialCipherService` encrypts integration credentials with AES-256-GCM using `INTEGRATION_CREDENTIALS_KEY`. Tenant-owned connections are assigned through `property_integration_connections`; PMS selection is single-active per property, payment options can coexist. The catalog's existence is not proof of successful connection health.

ADR-0024's structured phone and profile fields remain a **target**: User/Organization lack much of that profile shape and Guest still has a single phone field. Do not invent columns from the ADR.

## Audit and known review boundaries

AuditLogService records tenant-sensitive actions and supports global authentication events; notifications and integration manual-review items serve different operational purposes. The guest ledger has SELECT/INSERT RLS policies rather than normal UPDATE/DELETE policies.

The blanket "every cache key and queue message has tenant_id" rule needs context: auth/health keys and scheduler ticks are global by design; domain jobs carry tenant/property context. Clock's older cache and rate-limit keys use connection/API-user identity instead of always explicitly containing tenant/property IDs; see [Clock architecture](../integrations/clock/architecture.md). Review isolation before expanding them.

Neither this source inspection nor a completed historical milestone proves all RLS coverage, migration rerun safety, retention or production privileges. Those are behavioral/security checks, tracked in the [roadmap](../roadmap/README.md).
