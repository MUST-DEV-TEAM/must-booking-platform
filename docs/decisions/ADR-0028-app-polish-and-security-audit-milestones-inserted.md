# ADR-0028: Application Enhancement and Security & Architecture Audit milestones inserted before Platform Billing

Status: Accepted
Date: 2026-08-17

## Context

ADR-0025 last resequenced the roadmap: Milestone 12 (Integration & Initial Release Readiness) is the "initial usable version" checkpoint, followed immediately by Milestone 13 (Platform Billing) as the final milestone.

While reviewing a batch of live guest-journey bugs found against Milestone 12's own scope (WordPress toolbar/accommodation-detail wiring, added as Milestone 12 Tasks 21-23), the owner raised two gaps neither Milestone 12 nor the existing backlog currently covers as a dedicated, systematic pass:

1. **Application UI/UX and feature work.** Milestone 12 is scoped to integration/hardening/release-readiness for one real tenant (Empire Beach Resort), not general product polish. A standing decision from Milestone 9 close-out (build features first, fix Figma-fidelity gaps in a later dedicated pass) has never had its "later pass" scheduled. Open frontend-library decisions (ECharts vs. Recharts, Dinero.js adoption) and accessibility/responsive verification gaps documented in `apps/wordpress-plugin/docs/UI_UX.md`'s closing section ("Browser, theme, Elementor, keyboard, and screen-reader acceptance were not executed... remain unverified") are also unscheduled.
2. **A systematic security and architecture audit.** Milestone 12 Task 5 already ran a security pass, but it was explicitly scoped to "the real internet-facing surface" for one live tenant, not a full sweep of tenancy isolation, payment/billing separation, PMS-integration idempotency, and the other cross-cutting risk categories `AGENTS.md` names. The owner does not have the domain background to judge this alone and asked for a dedicated milestone rather than an ad hoc list.

The owner confirmed both should be real, numbered milestones — not backlog items — and should run in sequence (Application Enhancement first, then Security & Architecture Audit), after Milestone 12 closes (no parallel milestones, per the existing "worked in order" rule) and before Platform Billing.

## Decision

1. **Two new milestones are inserted** after Milestone 12 and before Platform Billing:
   - **Milestone 13: Application UI/UX & Feature Enhancements** — Figma-fidelity audit pass, open frontend-library decisions, accessibility/responsive verification, and owner-directed feature work not yet scoped elsewhere.
   - **Milestone 14: Security & Architecture Audit** — systematic pass across tenancy isolation, payment/platform-billing separation, PMS-integration idempotency, auth/authorization, webhook/callback verification, database/migration discipline, secrets handling, public API surface, and the WordPress guest-plugin domain-logic boundary (ADR-0016). Broader and more systematic than Milestone 12 Task 5's scoped pass; does not repeat work already verified there.
2. **Platform Billing moves from Milestone 13 to Milestone 15** — its own scope is unchanged (per ADR-0025's own precedent, only its position moves).
3. **The roadmap grows from 14 milestones (0-13) to 16 milestones (0-15).**
4. **Sequencing**: Milestone 13 and 14 do not start until Milestone 12 is fully closed out (all its tasks Done, file moved to `completed/`) — no parallel milestone work, matching the existing rule in `docs/roadmap/README.md`.
5. **Neither new milestone's task table is defined by this ADR.** Per the existing kickoff process, each gets its real task list written with the owner when it becomes active; this ADR only reserves the milestone slot, sets the goal, and records draft task areas as a starting point (not final), same as every other milestone file.

## Consequences

- `docs/roadmap/milestones/13-platform-billing.md` renamed to `15-platform-billing.md`; its header, "Depends on" line, and resequencing note updated to reflect the new position.
- Two new milestone files created: `docs/roadmap/milestones/13-app-ui-ux-and-features.md`, `docs/roadmap/milestones/14-security-and-architecture-audit.md`.
- `docs/ROADMAP.md` and `docs/roadmap/README.md` updated: milestone table/count, "Up next" pointer.
- Already-completed milestone files are not retroactively rewritten, per ADR-0023/ADR-0025's own precedent.
- Milestone 12 itself is unaffected — its own task table (including Tasks 21-23, the WordPress guest-journey findings that prompted this ADR) is unchanged; those stay in Milestone 12, they are not moved into the new milestones.

## Alternatives considered

- **Fold this into the existing backlog** (`docs/ROADMAP.md`'s "after Milestone 13, not scheduled" list) instead of numbered milestones: rejected — the owner explicitly wants a scheduled, dedicated pass, not an open-ended deferred item with no commitment to when it happens.
- **Start Milestone 13/14 now, in parallel with Milestone 12's remaining tasks**: rejected — breaks the established "worked in order, without skipping or parallelizing" rule for no stated benefit; Milestone 12 is close to done and the owner confirmed waiting for its close-out.
- **Put Security & Architecture Audit before Application Enhancement**: rejected — the owner explicitly wants Application Enhancement first.
