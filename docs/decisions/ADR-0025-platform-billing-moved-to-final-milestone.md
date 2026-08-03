# ADR-0025: Platform Billing moved to the final milestone

Status: Accepted
Date: 2026-08-03

## Context

ADR-0023 last resequenced the roadmap: Milestone 11 (Platform Billing) sat between Milestone 10 (Individual Room Booking) and Milestone 12 (Clock PMS+ Adapter), with Milestone 13 (Integration & Initial Release Readiness) as the final checkpoint.

While Milestone 9 (Tenant Admin Dashboard) is in progress, the owner asked to defer Platform Billing further — to the very end of the roadmap, after Clock and after Integration & Initial Release Readiness — reasoning that billing is monetization for MUST, not something tenants need to use the platform: Milestone 2 already made the Free plan permanent and self-serve, so a tenant can sign up, configure a property, and take guest bookings/payments without a real subscription ever existing. The owner wants the product functional end-to-end (Milestone 12's "initial usable version" checkpoint) before spending a milestone on MUST's own revenue mechanics.

There is no technical blocker to this, mirroring ADR-0023's finding about Platform Admin: Platform Billing's dependencies (Milestone 9's `apps/web` foundation, ADR-0003/0005/0007/0008/0009) don't require Clock or Integration & Release Readiness to exist first, and nothing in those two milestones requires real billing — Milestone 12's smoke test can run entirely on Free-plan tenants.

## Decision

1. **Platform Billing becomes the last milestone**, moving from Milestone 11 to Milestone 13.
2. **Clock PMS+ Adapter (Basic) moves from Milestone 12 to Milestone 11.**
3. **Integration & Initial Release Readiness moves from Milestone 13 to Milestone 12**, and becomes the new "initial usable version" checkpoint — not Milestone 13.
4. **New milestone order from Milestone 10 onward**: Milestone 10 Individual Room Booking (unchanged) → Milestone 11 Clock PMS+ Adapter (was 12) → Milestone 12 Integration & Initial Release Readiness (was 13) → Milestone 13 Platform Billing (was 11).
5. **Milestone 12's smoke test drops the "tenant upgrades plan" step** — tenants remain on Free through that checkpoint; the upgrade path is exercised for the first time in Milestone 13's own E2E test. Milestone 12 no longer depends on Milestone 13.
6. **Milestone 13 (Platform Billing)'s own scope is unchanged** — subscriptions, dunning, plan enforcement, cancellation, the plan-catalog/trial-length kickoff decision — only its position in the sequence moved.

## Consequences

- Milestone files renumbered: `11-platform-billing.md` → `13-platform-billing.md`, `12-clock-pms-adapter-basic.md` → `11-clock-pms-adapter-basic.md`, `13-integration-and-initial-release.md` → `12-integration-and-initial-release.md`. Each file's header, "Depends on" line, and internal Milestone-number references were updated to match.
- `docs/ROADMAP.md` and `docs/roadmap/README.md` updated: the "initial usable version" framing now points at Milestone 12, not 13. The roadmap is still 14 milestones numbered 0-13 — only the assignment of the last two slots changed.
- Active cross-references updated: `docs/BILLING.md`, `docs/roadmap/milestones/09-tenant-admin-dashboard.md` (in progress), `docs/roadmap/milestones/06-public-booking-widget.md` (paused), and `ADR-0024`.
- Per ADR-0023's own precedent, already-completed milestone files (`completed/00`, `completed/01`, `completed/05`, `completed/08`) and older ADRs (0013, 0014, 0015) that mention milestone numbers in passing are **not** retroactively rewritten — they're historical snapshots as of when they were written, same as ADR-0023 left them after the prior resequencing.
- Milestone 9's "Explicitly not included" and "Settings → Billing Account" notes now point to Milestone 13 instead of 11; no scope change to Milestone 9 itself.

## Alternatives considered

- **Leave Platform Billing at Milestone 11 (status quo)**: rejected — the owner explicitly wants the functional end-to-end product (Milestone 12's checkpoint) reached before spending a milestone on billing mechanics that don't gate tenant usage today.
- **Insert Platform Billing between Clock and Integration & Release Readiness (i.e., only move it past Clock, not past the release checkpoint)**: rejected — the release-readiness checkpoint is exactly the "functional first" milestone the owner is optimizing for; gating it on billing again would partially defeat the purpose.
