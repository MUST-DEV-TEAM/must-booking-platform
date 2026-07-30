# Roadmap process

The roadmap is 11 milestones, numbered **0 to 10**. Reaching Milestone 10 done means an initial, usable, end-to-end version of the platform exists — tenancy, booking, guest payments, platform billing, and a basic Clock PMS connection — even though it is **not** the fully hardened, feature-complete product (see each milestone's "explicitly not included" notes, and the backlog at the bottom of `docs/ROADMAP.md`).

**Active milestone: [05 — Guest Payments](milestones/05-guest-payments.md)**

Completed: [00 — Repository & Infrastructure Foundations](completed/00-repo-and-infra-foundations.md), [01 — Tenancy & Auth Core](completed/01-tenancy-and-auth-core.md), [02 — Self-Serve Signup & Free Plan Onboarding](completed/02-signup-and-free-trial-onboarding.md), [03 — Property, Room & Rate Management](completed/03-property-room-rate-management.md), [04 — Local Booking Domain & State Machine](completed/04-local-booking-domain.md)

## How a milestone works

1. **Kickoff**: at the start of a milestone, Claude and the owner define exactly **10 concrete tasks** for that milestone together, and Claude writes them into that milestone's file as a task table (id, description, acceptance criteria, status). The thematic list already in each milestone file is a draft starting point for that conversation, not the final task list — don't treat it as locked.
2. **Implementation**: Codex implements the tasks, most of the time one task at a time as a focused PR, per the conventions in `AGENTS.md`.
3. **Review**: Claude reviews each PR against the task's acceptance criteria (tenant scoping, idempotency, tests actually run, docs updated — per `CLAUDE.md`'s review checklist). Only Claude marks a task **Done** in the milestone file. Codex reports completion; it does not self-mark a task done, and does not decide a milestone is finished.
4. **Milestone close-out**: when all 10 tasks in a milestone are reviewed and marked Done, Claude marks the milestone Done, moves its file from `milestones/` to `completed/`, updates the "Active milestone" pointer above, and starts the kickoff conversation (step 1) for the next milestone with the owner.
5. **Order**: milestones are worked in order, 0 through 10, without skipping or parallelizing, unless the owner explicitly says otherwise for a specific case.

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
