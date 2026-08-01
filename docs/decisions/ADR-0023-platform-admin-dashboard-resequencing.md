# ADR-0023: Platform Admin Dashboard split out and moved earlier; Auth Pages inserted ahead of it

Status: Accepted
Date: 2026-07-31

## Context

ADR-0020's point 5 folded the Platform Admin dashboard into what was then Milestone 9 (Platform Billing), reasoning that both need cross-tenant backend access and building them together avoids standing up that surface twice.

Since then, real end-to-end testing of Milestone 6 (WordPress plugin) surfaced enough backend-completeness gaps (guest billing address storage, tenant-configurable payment gateways, PokPay) that the owner decided to pause WordPress work and prioritize finishing the core application first, with WordPress resuming as one consolidated integration pass before the final release-readiness milestone. In planning what "finish the core application" actually means next, the owner asked for the Platform Admin dashboard specifically to move earlier — ahead of even the Tenant Admin Dashboard — so MUST's own team can operate the platform sooner, rather than waiting for the full billing milestone.

Per ADR-0021 (published alongside ADR-0020), Platform Admin's actual backend needs are narrow: read access to `organizations`/`users`, plus two allowlisted write actions (suspend/reactivate a tenant, trigger a password reset). None of that depends on Milestone 9's original billing backend or the Tenant Dashboard existing first — there is no technical blocker to resequencing, only the original bundling decision.

Separately, `apps/web` was found to have no real designed UI at all yet — inspected directly, not assumed: no login page, no forgot/reset-password page, no `/platform` route. The existing signup form, tenant picker, and dashboard pages are unstyled scaffolding built incidentally for earlier milestones' E2E tests. Both the Platform Admin dashboard and the Tenant Admin Dashboard need a shared login page and a shared component library (Figma's "00 — Base & Components" page, already reviewed) — building that once, in its own milestone, avoids either dashboard re-deriving it or gating on the other.

## Decision

1. **Platform Admin Dashboard becomes its own milestone**, built before both the Tenant Admin Dashboard and Platform Billing. ADR-0021's mechanism (narrow RLS `SELECT` carve-out, allowlisted writes reusing the existing per-tenant write path, audit-log actor-shape) is entirely unchanged — this ADR changes *when and where* it's built, not *how*.
2. **A new Auth Pages milestone is inserted immediately before it** — shared login/signup/forgot-password UI, role-based post-login routing per ADR-0020, and the `apps/web` component-library foundation. The component-library task moves here from its original position at the start of the Tenant Dashboard milestone, since this is now the actual first `apps/web` UI milestone.
3. **New milestone order from Milestone 6 (WordPress, paused) onward**: Milestone 7 Auth Pages (new) → Milestone 8 Platform Admin Dashboard (this ADR, new) → Milestone 9 Tenant Admin Dashboard (was Milestone 8) → Milestone 10 Individual Room Booking (was Milestone 7 — also flips relative to the Tenant Dashboard; its own guest-widget follow-up tasks stay deferred alongside Milestone 6, per that pausing decision) → Milestone 11 Platform Billing (was Milestone 9, billing-only now) → Milestone 12 Clock PMS Adapter (was Milestone 10) → Milestone 13 Integration & Initial Release Readiness (was Milestone 11).
4. **Milestone 11 (Platform Billing)'s scope is otherwise unchanged** — subscriptions, dunning, plan enforcement, cancellation — it simply no longer also builds the platform-admin dashboard shell.
5. **Milestone task tables are no longer held to exactly 10 tasks** (owner-directed 2026-07-31) — a milestone's real scope determines its task count, whether that's 4 or 20. This relaxes `docs/roadmap/README.md`'s original "define exactly 10 concrete tasks" convention going forward, for every milestone, not just these two.

## Consequences

- ADR-0020's point 5 is superseded by this decision. Points 1-4 (one login/session, role-derived routing to `/platform` vs. `/dashboard`, one app not two, single `PLATFORM_ADMIN` role for now) are unaffected and still stand as originally decided.
- ADR-0021's mechanism is unaffected; its references to "Milestone 9" now resolve to the new Milestone 8 — no change to what it built, only which milestone number implements it.
- Milestone files old-7 through old-11 were renumbered (old 7→10, 8→9, 9→11, 10→12, 11→13) and two new files created (7, 8); cross-references in ADR-0020, ADR-0021, ADR-0022, and the roadmap index files (`docs/roadmap/README.md`, `docs/ROADMAP.md`) were updated to match.
- Milestone 9 (Tenant Dashboard)'s draft tasks referencing Milestone 10 (Individual Room Booking) features (manual-blocking calendar controls, per-property booking-mode setting) become explicit deferred follow-up tasks rather than "coming soon" placeholders, since the build order flipped.
- The roadmap's "12 milestones, numbered 0-11" framing needed updating to the new total (14 milestones, 0-13) in both index docs — done as part of this change, not left stale.

## Alternatives considered

- **Leave Platform Admin Dashboard bundled with Platform Billing, as ADR-0020 originally decided**: rejected — the owner explicitly wants MUST's own operational tooling available sooner, and ADR-0021 already established the backend work is narrow enough to decouple cleanly from full billing.
- **Move the entire original Milestone 9 (platform admin + billing) earlier as one unit, rather than splitting**: rejected — full Platform Billing (Stripe subscriptions, dunning, plan enforcement) is a materially bigger and genuinely separate concern from the admin dashboard's narrow oversight/allowlist scope; bundling them again just relocates the original coupling problem earlier instead of resolving it.
- **Fold Auth Pages into the Platform Admin Dashboard milestone rather than giving it its own**: rejected — both the Platform Admin dashboard and the Tenant Dashboard (and everything built in `apps/web` after) share one login page and one component library; building that foundation once, standalone, avoids either dashboard milestone re-deriving it or being gated on the other's kickoff.
