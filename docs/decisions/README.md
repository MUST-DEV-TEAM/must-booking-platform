# Architecture Decision Records

Index of durable, cross-cutting, or hard-to-reverse decisions. Routine implementation detail does not need an ADR.

| ID | Title | Status |
| --- | --- | --- |
| [ADR-0001](ADR-0001-monorepo-and-stack.md) | Monorepo with NestJS backend + Next.js frontend | Accepted |
| [ADR-0002](ADR-0002-tenant-isolation-strategy.md) | Tenant isolation strategy | Accepted — shared schema + RLS, hybrid escape hatch |
| [ADR-0003](ADR-0003-platform-billing-provider.md) | Platform billing provider | Accepted — Stripe Billing now, `BillingProvider` interface for PokPay later |
| [ADR-0004](ADR-0004-data-residency.md) | Data residency / hosting region | Accepted — EU now, room to expand later |
| [ADR-0005](ADR-0005-plan-limit-enforcement.md) | Plan limit enforcement style | Accepted — hybrid hard/soft |
| [ADR-0006](ADR-0006-multi-property-v1.md) | Multi-property tenants from v1 | Accepted |
| [ADR-0007](ADR-0007-pricing-model.md) | Pricing model shape | Accepted — flat tiered plans (Free/Basic + more later) |
| [ADR-0008](ADR-0008-onboarding-model.md) | Tenant onboarding model | Accepted — self-serve onto Free plan, no card upfront |
| [ADR-0009](ADR-0009-data-retention-churn.md) | Tenant data retention after cancellation | Accepted — 30-day grace then hard delete |
| [ADR-0010](ADR-0010-dashboard-tenant-routing.md) | Dashboard tenant routing | Accepted — tenant ID in the URL, no server-side selected-tenant state |
| [ADR-0011](ADR-0011-object-storage-provider.md) | Object storage provider and access model | Accepted — Cloudflare R2, public-read bucket, presigned upload only |
| [ADR-0012](ADR-0012-rate-plan-base-rate-model.md) | Base rate vs. date-bounded override in rate rules | Accepted — nullable-date rule is the base rate, dated rules are overrides |
| [ADR-0013](ADR-0013-local-inventory-consumption-model.md) | Local inventory consumption model for bookings | Accepted — separate `booked_units` counter, availability derived at read time |
| [ADR-0014](ADR-0014-booking-state-machine.md) | Booking state machine is the full production state list from Milestone 4 | Accepted — full state list from day one, `LocalPmsProvider` resolves PMS states synchronously |
| [ADR-0015](ADR-0015-guest-matching-rule.md) | Guest matching rule for Milestone 4 | Accepted — exact email match only, phone stored but never used to auto-merge |
| [ADR-0016](ADR-0016-guest-frontend-is-retrofitted-legacy-plugin.md) | Guest-facing frontend is the retrofitted legacy WordPress plugin, not a new widget | Accepted — import the legacy plugin as `apps/wordpress-plugin`, strip its domain/payment/PMS code, keep its UI; refined at Milestone 6 kickoff to drop the plugin credential in favor of ADR-0017's existing anonymous guest-session model |
| [ADR-0017](ADR-0017-anonymous-guest-session.md) | Anonymous guest session for quotes and booking creation | Accepted — new `must_guest_session` cookie + `@PublicTenantScoped` guard, distinct from staff `must_session` |
| [ADR-0018](ADR-0018-refund-policy-from-cancellation-snapshot.md) | Refund amount is driven automatically by the cancellation-policy snapshot | Accepted — `cancellation_is_free: true` triggers an automatic full refund; staff can still override manually |
| [ADR-0019](ADR-0019-reserve-then-expire-payment-pending.md) | Reserve inventory immediately, expire on payment timeout | Accepted — reserve at `PAYMENT_PENDING`, sweep abandoned checkouts to `EXPIRED` |
| [ADR-0020](ADR-0020-platform-admin-vs-tenant-dashboard-routing.md) | Platform Admin dashboard vs. Tenant dashboard routing | Accepted — one login, role-routed to `/platform/...` (MUST staff) or ADR-0010's `/dashboard/:tenantId/...` (tenant staff); one app, not two; platform/tenant roles mutually exclusive per account; single `PLATFORM_ADMIN` role for now. Point 5 (dashboard build folded into the billing milestone) superseded by ADR-0023. |
| [ADR-0021](ADR-0021-platform-admin-cross-tenant-data-access.md) | Platform Admin cross-tenant data access | Accepted — narrow SELECT-only RLS carve-out for reads, no bypass role/connection; writes reuse the existing per-tenant `SET LOCAL app.tenant_id` path via an explicit allowlist (suspend tenant, force password reset), no general cross-tenant write access. Mechanism unchanged by ADR-0023; only the milestone number implementing it moved. |
| [ADR-0022](ADR-0022-individual-room-booking-model.md) | Individual room booking model | Accepted — per-property `bookingMode` (Room-Type-Only / Individual-Room-Only / Mixed), room-level availability alongside Milestone 4's pooled count, optional per-room pricing, same-price invariant on Mixed mode's auto-assign path, flexible all/type/room manual blocking. Sequencing further changed by ADR-0023 (now Milestone 10, after the Tenant Dashboard). |
| [ADR-0023](ADR-0023-platform-admin-dashboard-resequencing.md) | Platform Admin Dashboard split out and moved earlier; Auth Pages inserted ahead of it | Accepted — supersedes ADR-0020 point 5; new Milestone 7 (Auth Pages) and Milestone 8 (Platform Admin Dashboard) inserted, Milestones 7-11 renumbered to 9-13; milestone task tables no longer held to exactly 10 tasks |
| [ADR-0024](ADR-0024-identity-and-contact-profile-fields.md) | Identity and contact-profile fields for User, Organization, Property, and Guest | Accepted — one shared `User` field set across Platform Admin/Tenant Owner/Tenant Admin/Tenant Staff (role/capability system remains the sole differentiator, not table shape); structured phone (country code + number) everywhere; target field lists fixed now, build timing decided separately per task/milestone |

All nine foundational ADRs are accepted as of 2026-07-27; ADR-0010, ADR-0011, and ADR-0012 followed on 2026-07-28 once Milestone 3 surfaced the need for dashboard tenant-routing, object-storage, and rate-plan-modeling decisions. ADR-0013 through ADR-0015 followed on 2026-07-30 at Milestone 4 kickoff, resolving the inventory-consumption, state-machine-scope, and guest-matching questions the source brief left open for the local-only path. ADR-0016 followed the same day, revising the guest-frontend plan from a green-field widget to a retrofit of the legacy plugin, ahead of Milestone 6. ADR-0017 followed immediately after, once Task 5's review surfaced that no anonymous-guest access path existed yet for the quote/booking-creation flow Milestone 4 (and eventually Milestone 6) actually needs. ADR-0018 and ADR-0019 followed at Milestone 5 kickoff, connecting Milestone 4's cancellation-policy snapshot to real refund behavior and settling when inventory is actually reserved relative to Stripe payment. ADR-0020 followed on 2026-07-31, ahead of Milestone 8 kickoff, fixing how MUST's own internal platform dashboard relates to the tenant dashboard Milestone 8 is about to build — extending ADR-0010's routing model rather than replacing it. ADR-0021 followed immediately after, resolving the cross-tenant data-access mechanism ADR-0020 left open — a narrow RLS read carve-out plus reuse of Milestone 1's existing per-tenant write path, deliberately not reopening Milestone 1 Task 2's removal of bypass-RLS access. ADR-0022 followed the same day, once live-testing Milestone 6's WordPress plugin surfaced a real gap — some tenants need guests to book a specific physical room, not just any unit of a pooled room type — inserting a new Milestone 7 ahead of the (renumbered) Tenant Admin Dashboard so its staff-facing controls exist before that dashboard needs to expose them. ADR-0023 followed the same day, once the owner decided to pause WordPress work (Milestone 6) and prioritize finishing the core application, and specifically wanted MUST's own Platform Admin dashboard available earlier than ADR-0020 originally sequenced it — splitting it out of the billing milestone into its own, earlier milestone, and inserting a new Auth Pages milestone ahead of it since both new dashboards need a shared login page and component library. ADR-0024 followed on 2026-08-02, once Milestone 9 Task 6 surfaced that no guest name field persisted anywhere — broadened into a full audit and brainstorm of identity/contact fields across every entity (`User`, `Organization`, `Property`, `Guest`), fixing the long-term target shape for each even though most of the fields aren't built yet. Nothing currently blocks the active milestone on an unresolved foundational decision — see `docs/roadmap/README.md` for what's next. Remaining open questions are implementation-level details noted inline in specific ADRs (e.g. exact Free-plan trial semantics in ADR-0008, further plan tiers in ADR-0007) — not new ADRs, just details to confirm during the phase that implements them.

Additional ADRs will be required for the remaining decisions listed in `docs/source/clock-pms-integration.pdf` section 38 (availability endpoint, booking create payload, PUSH vs SQS, cache/retry/conflict policy, etc.) once Clock adapter work starts in Milestone 10 — guest matching's local-only precedence is now settled by ADR-0015, though Clock's external-ID signal will extend it.

## Template

```
# ADR-XXXX: <title>

Status: Proposed | Accepted | Superseded by ADR-YYYY
Date: YYYY-MM-DD

## Context
## Decision
## Consequences
## Alternatives considered
```
