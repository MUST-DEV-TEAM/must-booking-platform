# Roadmap process

The roadmap is 14 milestones, numbered **0 to 13** (per [ADR-0023](../decisions/ADR-0023-platform-admin-dashboard-resequencing.md), which inserted Auth Pages and split out a standalone Platform Admin Dashboard milestone). Reaching Milestone 13 done means an initial, usable, end-to-end version of the platform exists — tenancy, booking, guest payments, staff-facing operations, platform administration/billing, and a basic Clock PMS connection — even though it is **not** the fully hardened, feature-complete product (see each milestone's "explicitly not included" notes, and the backlog at the bottom of `docs/ROADMAP.md`).

**Active milestone: 09 — Tenant Admin Dashboard**, kickoff not yet started. Milestone 8 (Platform Admin Dashboard) closed out 2026-08-02 — all 15 tasks Done, moved to `completed/`. It was reopened same-day after first closing at 12 tasks: the owner reviewed the live `/platform` screen against the real Figma file and found the shared dashboard shell (`packages/ui`'s `AppShell`/`SidebarNavigation`) had no real desktop header, icons, or brand block, plus a genuine nav bug (the dashboard home never linked to `/platform/tenants`) — a lesson that checking CSS values trace to real tokens is not the same as checking the actual layout matches the design. Tasks 13-15 fixed the shared shell (benefiting Milestone 9 too), wired `/platform` onto it, and added an Audit Log page. Milestone 7 (Auth Pages) closed out 2026-08-01 — all 10 tasks Done, moved to `completed/`. Milestone 5 (Guest Payments) was reopened 2026-07-31 for tenant-configurable gateways/PokPay/emails (tasks 11-13) and has since been re-closed — all 13 tasks Done. Milestone 4 was reopened the same way for a missing guest-billing-address gap and has also been re-closed.

**[06 — WordPress Plugin Retrofit](milestones/06-public-booking-widget.md) is paused (2026-07-31)**, not closed: backend/core-app milestones took priority since real end-to-end testing of the guest widget kept surfacing backend gaps that belonged to those milestones, not the plugin's. WordPress integration resumes as one consolidated pass before Milestone 13 — each subsequent milestone's own guest-widget-facing tasks (e.g. Milestone 10's individual-room-picker tasks) get explicitly marked deferred at that milestone's kickoff rather than silently dropped or forced through against a still-moving backend.

**Up next after Tenant Admin Dashboard**: Milestone 10 (Individual Room Booking), Milestone 11 (Platform Billing), Milestone 12 (Clock PMS Adapter), Milestone 13 (Integration & Initial Release Readiness, where WordPress's deferred work gets picked back up). See `docs/ROADMAP.md` for the full table.

Completed: [00 — Repository & Infrastructure Foundations](completed/00-repo-and-infra-foundations.md), [01 — Tenancy & Auth Core](completed/01-tenancy-and-auth-core.md), [02 — Self-Serve Signup & Free Plan Onboarding](completed/02-signup-and-free-trial-onboarding.md), [03 — Property, Room & Rate Management](completed/03-property-room-rate-management.md), [04 — Local Booking Domain & State Machine](completed/04-local-booking-domain.md), [05 — Guest Payments](completed/05-guest-payments.md), [07 — Auth Pages](completed/07-auth-pages.md), [08 — Platform Admin Dashboard](completed/08-platform-admin-dashboard.md)

## How a milestone works

1. **Kickoff**: at the start of a milestone, Claude and the owner define the concrete tasks that milestone actually needs together, and Claude writes them into that milestone's file as a task table (id, description, acceptance criteria, status). Task count is not fixed at 10 (relaxed 2026-07-31, per ADR-0023) — a milestone might need 4 tasks or 20; what matters is that each task's real objective gets done, not hitting a round number. The thematic list already in each milestone file is a draft starting point for that conversation, not the final task list — don't treat it as locked.
2. **Implementation**: Codex implements the tasks, most of the time one task at a time as a focused PR, per the conventions in `AGENTS.md`.
3. **Review**: Claude reviews each PR against the task's acceptance criteria (tenant scoping, idempotency, tests actually run, docs updated — per `CLAUDE.md`'s review checklist). Only Claude marks a task **Done** in the milestone file. Codex reports completion; it does not self-mark a task done, and does not decide a milestone is finished.
4. **Milestone close-out**: when all 10 tasks in a milestone are reviewed and marked Done, Claude marks the milestone Done, moves its file from `milestones/` to `completed/`, updates the "Active milestone" pointer above, and starts the kickoff conversation (step 1) for the next milestone with the owner.
5. **Order**: milestones are worked in order, 0 through 13, without skipping or parallelizing, unless the owner explicitly says otherwise for a specific case (as with Milestone 6 currently paused, and Milestone 10 now sequenced after Milestone 9 rather than before).

## Directory layout

```
docs/roadmap/
  README.md           this file — process + current pointer
  milestones/         active/not-yet-started milestones, one file each
  completed/          finished milestones, moved here on close-out
```

## Task file convention (filled in at kickoff)

Each milestone file gets a table like this once its 10 tasks are defined:

| # | Task | Acceptance criteria | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | ... | ... | Not started / In progress / In review / Done | ... |

Status is only ever advanced to **Done** by Claude, after review.
