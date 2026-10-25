# Milestone 28: Release and cutover

Status: **Planned — opened 2026-10-25.** The merge of `main` and the redesign branch is on hold until the owner says so, and not before [Milestone 27](27-clock-rates-cancellation-permissions.md) is finished.

## Goal

Move the redesigned dashboard (including the platform admin console and the email system) onto the live site at booking.must.al without breaking Empire Beach Resort, its owner or its staff, with a tested rollback.

## State on 2026-10-25 (verified on the redesign branch, commit `bd8e3fe` and the Reservations fix after it)

- The client dashboard and the platform admin console are merged on `codex/design-dashboard-latest` (no conflicts; one lockfile line aligned).
- Verified in an isolated copy that does not touch the local database: frozen install, build, lint, format check, all 167 migrations on a fresh database, web tests 710/710, shared UI tests 42/42, API tests with real Postgres and Redis 1,616 passed, browser tests 8/8. The browser tests were rewritten for the redesigned screens.
- `main` (live, deployed through the release pipeline) is 107+ commits ahead of the old snapshot this branch started from; the branch is 5+ commits behind live. A dry-run merge with `main` conflicts in about 10 files.

## Tasks

| # | Task | Notes | Status |
| --- | --- | --- | --- |
| 1 | **Owner decisions on behaviour changes** | A refund above the remaining balance is refused instead of capped; a refund that cannot be confirmed also records a payment/booking mismatch review item; the guest cancel link now opens the app's own manage page. Check how the WordPress plugin handles the new link. | Needs the owner |
| 2 | **Wire the 12 unwired email situations** | 14 of 26 email situations have real senders; 12 can be drafted but not published. Decide which ship now. | Planned |
| 3 | **Merge `main` into the redesign branch** | Settle the ~10 conflicting files, rerun the full isolated verification. Only when the owner says so. | On hold |
| 4 | **Fix the time-of-day test** | `properties.e2e` expects a "too far ahead" rejection and fails between 22:00 and 24:00 UTC. | Planned |
| 5 | **Test for the retired-room-type filter** | Cover the Clock catalog sync change (`operational_until`). | Planned |
| 6 | **Confirm the "Live booking check" job** | It failed daily from 22 October; a fix is merged. Confirm it is green after the next deploy. | Planned |
| 7 | **Build without a live font download** | The web build fetches Google Fonts and fails intermittently. Bundle the font locally. | Planned |
| 8 | **Go-live security subset of Milestone 14** | Choose the audits that must pass before cutover (rights and tenant isolation, webhooks, secrets, SSH access) and defer the rest explicitly. | Planned |
| 9 | **Pre-cutover rehearsal** | Run the merged build against a copy of Empire's data, with the same owner and staff logins, and check the guest, staff and platform journeys. | Planned |
| 10 | **Deploy, verify, rollback plan** | Fresh backup, deploy outside busy hours, verify with the live booking check and a real read-only walk through Empire, and keep the previous release for rollback. | Planned |
| 11 | **Tidy** | Remove temporary working folders and test containers left on the owner's laptop; update the roadmap page when this closes. | Planned |

## Done when

Everything above is Done or explicitly deferred with a reason, the owner has signed off, and the live site runs the new build with Empire verified.
