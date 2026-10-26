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

Property email sender setup reuses that cipher with authenticated tenant/property, endpoint and credential-revision binding. Forced-RLS `email_sending_profiles` exposes credential presence rather than secret values; pending custom setup does not activate a transport. The [M24 email contract](../roadmap/milestones/24-notifications-emails-audit-plan.md#e4-sender-profile-storage-and-contract) owns its setup/verification boundary; SMTP diagnostics reserve/finalize a scoped operation with an audited retry receipt; they do not activate a sender or send a message. Scoped forced-RLS `email_sender_proofs` stores a bound challenge hash and encrypted immutable security email for 30 minutes, with three requests per rolling hour and five distinct guesses. Only a reference enters the existing sensitive-mail queue. Use, replacement or expiry prevents further use; the existing scoped mail sweep recovers publication and clears expired payloads. Proofs use the default MUST sender and never activate custom delivery. Domain diagnostics reuse the scoped operation/audit journal; a committed registration marker prevents another create after an uncertain provider outcome. DNS records and separate DMARC publication evidence are cached on the existing profile. Default MUST domain checks only read provider data. Domain transaction/concurrency verification is owner-deferred; transport attempt ownership and explicit activation are wired, with real database verification owner-deferred.

ADR-0024's Organization fields remain a target; the optional User profile rollout is recorded below. Guest matching/contact storage follows the current schema rather than inferred ADR columns.

## Audit and known review boundaries

AuditLogService records tenant-sensitive actions and supports global authentication events; notifications and integration manual-review items serve different operational purposes. The personal inbox uses scoped notification_reads and versioned per-user inbox state; the legacy shared read_at is not attributed to a person. Permission routing and 90-day inbox retention are defined in the [M24 contract](../roadmap/milestones/24-notifications-emails-audit-plan.md#a3-contract-and-rules-before-implementation); expiry never resolves or removes the underlying booking/review evidence. The guest ledger has SELECT/INSERT RLS policies rather than normal UPDATE/DELETE policies.

The M24 Activity audit workspace reuses exact-property audit_logs with existing-capability family visibility and staff.view actor privacy. New minimal request_context contains only request reference, method and route template. Successful account security observations are prospectively copied to properties accessible at occurrence, explicitly labelled as account events, not property usage. Forced-RLS audit_export_operations holds per-user versioned/idempotent CSV receipts for 24 hours; cleanup never deletes source audit evidence. See the [A4 contract and evidence](../roadmap/milestones/24-notifications-emails-audit-plan.md#a4-contract-and-rules-before-implementation) for bounds, sanitization and missing-history rules.

M24 custom email dispatch adds forced-RLS email_transport_attempts with tenant/property/message/stage identity and scoped property/message foreign keys. Prepared content and custom credentials are encrypted for seven days, then cleared by the existing property-scoped mail sweep; tombstones/receipts remain. Fenced exclusive attempts never reclaim unknown acceptance; receipt and non-secret job audit commit atomically. Fallback is a distinct frozen, audited stage permitted only after proven rejection and explicit guest preference; account/security mail remains on MUST. Migration deployment and real database concurrency/RLS tests are owner-deferred. See the [E4 contract](../roadmap/milestones/24-notifications-emails-audit-plan.md#corrective-e4-frozen-custom-dispatch-and-exclusive-attempts) for conservative uncertainty handling and verification limits and the activation/owner-alert contract.

M24 email_transport_failures and email_transport_failure_outbox also force exact tenant/property RLS. Each actionable source has a root; a fixed rolling-hour incident anchor groups owner notifications without extending the first hour during a continuous outage. Frozen default-MUST owner messages expire after seven days, while source roots retain detection/audit evidence. Owner eligibility and the same verified address are checked before publication and at each send attempt; owner-mail failures never recurse. Queue publication is confirmed only against actual scoped intentions and a retained job or terminal state. These migrations and real concurrency/RLS tests remain owner-deferred. The E4 plan records activation/pause contracts, immutable routing assumptions and controlled sender tests and explicit staff To/CC/BCC routing.

The blanket "every cache key and queue message has tenant_id" rule needs context: auth/health keys and scheduler ticks are global by design; domain jobs carry tenant/property context. Clock's older cache and rate-limit keys use connection/API-user identity instead of always explicitly containing tenant/property IDs; see [Clock architecture](../integrations/clock/architecture.md). Review isolation before expanding them.

Neither this source inspection nor a completed historical milestone proves all RLS coverage, migration rerun safety, retention or production privileges. Those are behavioral/security checks, tracked in the [roadmap](../roadmap/README.md).

M24 explicit staff recipient headers use additive fields on the existing forced-RLS notification rules, email messages and delivery slots. Legacy private lists remain private until saved with explicit channels. Approved envelopes and recipient-specific outcomes are exact-property data; body previews never include BCC headers. New header writes use the existing versioned/idempotent configuration operation. The [E4 recipient contract](../roadmap/milestones/24-notifications-emails-audit-plan.md#corrective-e4-recipient-channels-contract-before-implementation) owns routing, conservative grouped retries and pending migration/database verification.


### Optional account details (2026-10-22)

Migration `20261022130000_optional_account_profile` adds nullable structured phone, birth date, preferred language, personal timezone and job title to the shared User identity. Auth profile reads/updates use narrowly scoped SECURITY DEFINER functions, pinned search paths and app-role grants; the authenticated user's ID is supplied by AuthService, never request body identity. Omitted fields are preserved and explicit null clears an optional value. Language/timezone are stored preferences; this change does not claim a complete application localization rollout. Guest profiles remain separate. The additive migration is idempotent; rollback requires preserving profile values and stopping function callers before owner-approved column/function removal. Applied and recorded only on localhost.


### Immutable booking terms and guest-origin requests (2026-10-23)

Migration `20261023020000_booking_terms_and_guest_requests` adds nullable `bookings.cancellation_terms`, captured by an insert trigger for new MUST-origin bookings without an external ID. An update trigger rejects changes; no historical backfill occurs. Existing tenant/property RLS remains. `booking_requests.requester_id` becomes nullable and `guest_session_id` is added; an exclusive-origin constraint requires exactly one staff requester or guest session, and a trigger prevents changing that origin. Signed guest access is bound to the tenant, property, booking and its actual stored session; it does not grant staff identity or capabilities. Review uses the authenticated reviewer for approved guest execution.

Migration `20261023010000_account_date_format` adds optional user date-format preference through the existing own-profile SECURITY DEFINER functions, preserving their pinned search path and restricted grants. Both migrations were applied only to localhost. Rollback requires stopping new callers and preserving/exporting agreed terms and guest requests before restoring functions/triggers or removing fields; do not erase their history to downgrade.

Signed guest previews return private/no-store and no-referrer headers. API request logging strips query strings (including guest capabilities and search terms) and retains existing upload-token path redaction. Direct guest Clock cancellation applies the same current money coverage, online-refund and shared-order safeguards as the management page.

### Hotel date display preference (2026-10-23)

Additive migration `20261023030000_hotel_date_format` adds `properties.date_format`, default DD/MM/YYYY, with a three-format check constraint. It is safe to replay and adds no table or tenancy boundary; reads/writes use the existing tenant/property-scoped property contract and `settings.manage`. It changes display preferences, never stored booking dates. The old optional user date-format column is retained but no longer drives the account form. Rollback requires stopping callers, exporting saved preferences and owner approval before dropping the column; application rollback can safely leave it in place.

### Prospective audit evidence (ADR-0037)

New audit inserts store a versioned `_audit` envelope with explicit outcome, source and optional operation reference. Reviewed event defaults apply only when writing new rows; historical missing outcomes remain unspecified. Payment request, provider-confirmed receipt, refund pending and uncertain provider outcomes are separate events. Shared connection/access observations are copied only to hotels affected at occurrence, labelled as shared events. Exact saved operation references link authorized evidence; nearby events remain a separate view. Before-storage secret redaction supplements read redaction. Storage failures emit a generic operational signal and abort their local transaction; they never authorize repeating a provider action.

Migration `20261024010000_audit_append_only` adds restrictive application-role UPDATE/DELETE policies and a scoped operation-reference index. Existing SELECT/INSERT scope and maintenance authority remain. No source-history rewrite or deletion is performed. Retention periods, production backup/restore checks and external alert delivery remain deployment-specific follow-up; see [ADR-0037](../decisions/ADR-0037-audit-event-evidence.md).
