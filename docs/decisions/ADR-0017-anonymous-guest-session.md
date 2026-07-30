# ADR-0017: Anonymous guest session for quotes and booking creation

Status: Accepted
Date: 2026-07-30

## Context

Milestone 4's whole point is a guest-initiated booking flow (quote → availability revalidation → booking creation), but Task 5 built the quote endpoint (`QuoteController`) behind `@TenantScoped` — the same guard used by every staff-facing admin route, which requires an authenticated `must_session` cookie (Redis-backed, tied to a `tenant_memberships` row via `TenantContextGuard`). This was a reasonable default given it's the only session/access-control mechanism that exists in the codebase so far (Milestones 1–3 were entirely staff-facing), but it means no actual hotel guest — who has no MUST staff account at all — can call it. Task 5's own test proves this: it reuses the staff login's `must_session` cookie value as the quote's "guest session" binding. Task 6 (idempotent booking creation) and Milestone 6 (the real public-facing widget/WordPress retrofit) both need real anonymous access to work at all.

## Decision

Introduce a second, unauthenticated session concept distinct from staff sessions: a `must_guest_session` cookie — a random opaque token, set on a guest's first quote/availability/booking-related request, carrying no user identity, tenant membership, or RBAC/capability information. It exists purely to bind a quote (and later, other guest actions) to "the same browser," for tamper/replay protection — not to authenticate anyone.

A new guard (e.g. `PublicTenantScopedGuard`, paired with a `@PublicTenantScoped({ propertyParam })` decorator) replaces `@TenantScoped` on guest-facing routes (quotes now; booking creation from Task 6 onward). It performs the same tenant/property-existence validation `TenantContextGuard` already does (the route's `tenantId`/`propertyId` params must resolve to a real, matching property) but does **not** require a `must_session` cookie or a `tenant_memberships` row. It reads an existing `must_guest_session` cookie if present, or issues a new one (`Set-Cookie`), and exposes the resulting guest session ID on the request (e.g. `request.guestSessionId`) for controllers to pass into `QuoteService`/`LocalPmsProvider`.

## Consequences

- `QuoteController` (Task 5) is retrofitted: `@TenantScoped` → `@PublicTenantScoped({ propertyParam: 'propertyId' })`, and `sessionId()` reads `must_guest_session` instead of extracting a value from the staff cookie. The quote-creation test built for Task 5 needs updating since it currently proves guest access is impossible (it reuses a staff `must_session` value) — it should instead prove the endpoint works with no authentication at all, only the new guest-session cookie.
- Task 6's public booking-creation endpoint uses the same `@PublicTenantScoped` guard and passes the request's `guestSessionId` through to `LocalPmsProvider.createBooking`'s `quoteSessionId` field, so a booking can only be completed by whoever holds the same guest-session cookie that created the quote.
- Staff should still be able to create quotes/bookings on a guest's behalf (e.g. a phone booking entered by front desk) — `PublicTenantScopedGuard` accepts *either* a valid `must_session` (staff, populating `tenantContext` as `TenantContextGuard` does today) *or* a `must_guest_session` (anonymous), never requiring both. A quote created under a staff session binds to that staff session's ID the same way a guest session would; `QuoteService` doesn't need to know or care which kind of session ID it was given.
- Because a guest session carries no RBAC/capability information, any route reachable via `@PublicTenantScoped` alone must never expose tenant-internal data or actions beyond what an anonymous visitor to the hotel's public booking page should see (availability, quotes, booking creation, booking status by external reference/signed link). No staff-only action is ever reachable through a guest session.
- `LocalPmsProvider.createBooking`'s existing `quoteSessionId` field (Task 5) already threads through to `QuoteService.validate`'s session-binding check unchanged — this ADR only changes *what kind of session* supplies that ID, not the validation logic itself.
- This is scoped now (ahead of Task 6) specifically so Task 6 doesn't have to invent it under its own pressure, and so Milestone 6's widget/plugin retrofit (ADR-0016) has a ready-made, already-tested mechanism to call into rather than needing its own session design work.

## Alternatives considered

- Defer to Milestone 6 kickoff (leave Task 6's booking-creation API behind staff auth for now): rejected per the owner's explicit preference — every guest-facing endpoint in Milestone 4 and 6 would otherwise need revisiting later instead of getting it right once, now, while it's cheap and contained to a single guard.
