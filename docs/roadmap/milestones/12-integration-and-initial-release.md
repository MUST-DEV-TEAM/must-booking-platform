# Milestone 12: Integration, Hardening & Initial Release Readiness

Status: Not started
Depends on: Milestones 0-11

**WordPress integration note (2026-07-31):** Milestone 6 (WordPress Plugin Retrofit) was paused mid-flight and Milestone 10's guest-widget tasks (individual-room picker, direct-room-entry) were deferred alongside it. This milestone's task table must include the consolidated pass that finishes both against whatever the backend looks like by this point — not assume Milestone 6 is otherwise done.

**Resequencing note (2026-08-03, ADR-0025):** Platform Billing moved from Milestone 11 to Milestone 13 (last), after this milestone rather than before — the owner wants the product functional end-to-end first, and Milestone 2's permanent Free plan already makes that possible without real billing. This milestone no longer depends on Platform Billing, and its smoke test does not include an upgrade step: tenants remain on Free through this checkpoint.

## Goal

Everything from Milestones 0-11 works together as one coherent, demoable, deployable initial version. This is **not** the fully production-hardened product (see the backlog in `docs/ROADMAP.md`) — it is the "we have something real" checkpoint: reaching this milestone done is the definition of "initial version, even if not complete" from the roadmap's framing. Platform Billing (Milestone 13) is intentionally not part of this checkpoint.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. Cross-milestone E2E smoke test: signup (Free) → configure property/rates → guest books via widget → guest pays → staff sees it in dashboard → (optional) Clock-connected tenant syncs a booking.
2. Basic observability: structured logs, error tracking, and a minimal metrics/alerting setup (source brief section 28's list, scoped down — not the full production checklist).
3. Security pass: rate limiting on public endpoints, secrets audit, dependency audit, basic SSRF/input-validation review across the API surface built so far.
4. Staging deployment pipeline (CI/CD, per `docs/ARCHITECTURE.md`'s infra list) — a real environment the owner can click around in.
5. Seed/demo data scripts (a realistic demo tenant with rooms, rates, and sample bookings) for demos and manual QA.
6. Bug-fix buffer: triage and fix issues surfaced by the smoke test and staging use across Milestones 0-11.
7. Basic reconciliation job: booking/payment consistency check (source brief section 22, minimal version) to catch the most likely real-world drift.
8. Documentation pass: `README.md`, `docs/OPERATIONS.md`-equivalent (setup/deploy/diagnose), and each milestone's file confirmed accurate against what was actually built.
9. Production activation checklist drafted (source brief section 32/36-style) — not executed, just written, so go-live is a deliberate future decision, not a surprise.
10. Go/no-go review with the owner: walk through the demoable system, confirm what's genuinely usable vs. still backlog, and confirm Milestone 13 (Platform Billing) is next, followed by production hardening, more plan tiers, WordPress migration, additional PMS vendors — see `docs/ROADMAP.md`'s backlog.

## Explicitly not included

- Platform Billing (Milestone 13) — real subscriptions, dunning, plan enforcement; tenants stay on Free through this milestone.
- Full production certification of the Clock integration (remaining source-brief deliverables/hardening).
- Legacy WordPress plugin decommissioning.
- Additional PMS vendors, multi-currency billing, marketplace features — all backlog per `docs/ROADMAP.md`.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
