# ADR-0026: Tenant-owned integration connections (payment gateways & PMS)

Status: Accepted
Date: 2026-08-04

## Context

Milestone 11 (Clock PMS+ Adapter) is next up, and its milestone file has only ever had a one-line placeholder for how a tenant "connects" to Clock — no schema, no credential-storage design, no ADR. Per this repo's kickoff process (`CLAUDE.md`), an open architectural detail like this needs to be resolved with the owner before Milestone 11's task table is written, not assumed mid-kickoff.

At the same time, the existing guest-payment gateway feature (Milestone 5, closed, reopened once on 2026-07-31) only supports a **platform-shared** model: `Property.stripeEnabled` / `Property.pokpayEnabled` are on/off toggles against MUST's own single Stripe account and single PokPay merchant account (both configured via server-side environment variables, not stored per-tenant). No tenant has ever supplied their own payment-provider credentials, and the codebase has no PMS connection concept at all — `PmsProvider` (the interface from Milestone 4) has exactly one implementation (`LocalPmsProvider`) wired as a single, process-wide NestJS binding, with no per-tenant or per-property selection mechanism.

The owner wants tenants to connect their **own** third-party accounts (their own PokPay merchant, their own Stripe account, their own Clock PMS login) rather than opting into MUST's shared accounts, and wants this decided as one system covering both payment gateways and PMS, not two unrelated features — clarified through direct discussion (see Decision).

Storing real, later-decryptable third-party API credentials is also new ground for this codebase's security posture: today's only sensitive-data patterns are one-way password hashing (`bcrypt`) and HMAC-SHA256 signing for integrity (quote snapshots, cancellation links) — nothing in the codebase currently encrypts a value for storage and decrypts it again later to make an outbound API call.

## Decision

1. **Tenant-owned credentials, not platform-shared accounts.** A tenant enters their own PokPay/Stripe/ClockPMS credentials; guest payments and PMS operations run against the tenant's own account, not MUST's.

2. **One unified concept — "Integration Connection" — covers both payment gateways and PMS**, sharing the same underlying mechanics (store credentials, name the connection, test it, assign it to properties), rather than building two separate, parallel systems. The two connection *kinds* differ in one respect: a property may have several payment connections active at once (the guest picks at checkout, matching today's existing multi-toggle behavior), but at most **one** PMS connection active at a time (a room's availability can only have one authoritative source).

3. **Multiple named connections of the same provider type are allowed per organization** (e.g. two separate PokPay connections for two legal entities within one tenant group), each independently assignable to different properties. Rejected the simpler "one connection per provider per org" alternative in favor of this, per the owner's explicit preference for the added flexibility.

4. **Credentials are encrypted at rest**, masked on display (e.g. `pk_live_••••1234`) after initial entry, validated with a live "test connection" call at save time, and changes are audit-logged. The exact encryption mechanism (e.g. AES-256-GCM with a master key outside the database) is **not fixed by this ADR** — it's a security-sensitive implementation detail to be resolved at Milestone 11 kickoff, informed by this ADR's requirement that it be a genuinely reversible, envelope-style encryption (unlike anything currently in the codebase), not a follow-on assumption.

5. **Platform admin has oversight only** — MUST's internal team can see which tenants are connected to what (for support/troubleshooting), but which provider types exist at all is controlled by what's been built and released, using the existing plan-tier gating (`Plan.pmsEnabled`, `Plan.maxPmsConnectionsPerProperty`) as the access-control mechanism. No new platform-admin "enable/disable this provider platform-wide" control is being built now.

6. **Sequencing**: the generic Integration Connection foundation (schema, encryption, tenant-facing connection management UI, admin oversight) is built as the first portion of **Milestone 11**, immediately followed by the real `ClockPmsProvider` implementation on top of it — this fits Milestone 11's existing goal without renumbering anything. Migrating the existing Stripe/PokPay guest-payment toggle from platform-shared to tenant-owned credentials is **deferred to a short, dedicated reopening of Milestone 5** immediately after, reusing the foundation Milestone 11 built — the same pattern already used twice on this project (Milestone 8, Milestone 9) for a scoped post-close addition, rather than a redesign.

## Consequences

- Milestone 11's task table (kickoff not yet started) must include the Integration Connection foundation as its own early tasks, before the Clock-specific catalog-sync/booking tasks that depend on it.
- Milestone 5 will be reopened a second time (first reopening: 2026-07-31, for the existing gateway toggle and PokPay support) for the tenant-owned-credentials migration. `docs/ROADMAP.md`'s Milestone 5 entry will need another line noting this.
- `Property.stripeEnabled` / `Property.pokpayEnabled` / `Property.payAtHotelEnabled` are **not removed or restructured** — they keep meaning "guests can pay this way at this property," just resolved against a tenant's own connection instead of a platform-shared account once the Milestone 5 follow-up lands.
- `PmsProvider` selection moves from a single global DI binding to a per-property lookup keyed by the property's active PMS connection — a real change to `apps/api/src/booking/local-pms.provider.ts`'s wiring, scoped to Milestone 11.
- The existing `IntegrationOperation` table (tenant/property-scoped, provider-agnostic idempotency/outbox) is reused as-is for Clock PMS operations; it is not part of the new Integration Connection concept (one tracks *what a connection is*, the other tracks *what happened using it*).
- A follow-on decision — the specific encryption mechanism for stored credentials — is still open and must be settled at Milestone 11 kickoff before the foundation's schema is finalized.

## Alternatives considered

- **Keep platform-shared accounts, tenant just toggles on/off (status quo)**: rejected — the owner explicitly wants tenants to bring their own merchant/PMS accounts, not opt into MUST's.
- **Separate, unrelated systems for payment-gateway connections and PMS connections**: rejected — the owner confirmed a single unified "Integrations" concept is the right mental model, even though payment and PMS connections behave differently once assigned to a property.
- **One connection per provider per organization**: rejected in favor of allowing multiple named connections of the same provider type, per the owner's explicit preference for multi-entity flexibility.
- **Platform admin can enable/disable provider types platform-wide**: rejected for now — oversight-only is sufficient today; existing plan-tier gating already controls access. Can be revisited later if an operational need arises (e.g. an incident requiring a fast kill-switch).
- **Do the Stripe/PokPay tenant-credential migration before starting Clock PMS**: rejected — Clock PMS is what actually requires the foundation to exist; building it detached from Milestone 11 would mean designing it without a real consumer driving the requirements.
