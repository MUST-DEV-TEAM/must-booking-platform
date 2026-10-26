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
| 4b | **Clock webhook health check sees no hotels** | Found 2026-10-26: ClockWebhookHealthService lists Clock connections under the platform_admin role, but row-level security hides integration_connections from that role (checked in psql: 0 rows with the role set), so its stale-webhook alert can never fire. The new function clock_connected_properties() (migration 20261026020000) is the fix to reuse. | Planned |
| 4 | **Fix the time-of-day test** | `properties.e2e` expects a "too far ahead" rejection and fails between 22:00 and 24:00 UTC. | Planned |
| 5 | **Test for the retired-room-type filter** | Cover the Clock catalog sync change (`operational_until`). | Planned |
| 6 | **Confirm the "Live booking check" job** | It failed daily from 22 October; a fix is merged. Confirm it is green after the next deploy. | Planned |
| 7 | **Build without a live font download** | The web build fetches Google Fonts and fails intermittently. Bundle the font locally. | Planned |
| 8 | **Go-live security subset of Milestone 14** | Choose the audits that must pass before cutover (rights and tenant isolation, webhooks, secrets, SSH access) and defer the rest explicitly. | Planned |
| 9 | **Pre-cutover rehearsal** | Run the merged build against a copy of Empire's data, with the same owner and staff logins, and check the guest, staff and platform journeys. | Planned |
| 10 | **Deploy, verify, rollback plan** | Fresh backup, deploy outside busy hours, verify with the live booking check and a real read-only walk through Empire, and keep the previous release for rollback. | Planned |
| 11 | **Tidy** | Remove temporary working folders and test containers left on the owner's laptop; update the roadmap page when this closes. | Planned |

## Gate evidence, 2026-10-26 (steps 1 and 3 of the gate)

**Step 1, live merged into the redesign (commit `cf284d3` and fixes).** Conflicts were in photo storage (kept live's `STORAGE_DRIVER=local`; the redesign's `ServerStorageProvider`/`/api/media` was removed, ADR-0034 amended), PokPay environment helpers (both kept: live's host allow-list plus the redesign's production-webhook check), the Clock catalogue cache (redesign's fuller version), the currency switcher (live's dropdown) and the Clock test date helpers (redesign's). Full isolated run on the merged code: install, build, lint, format and migrate pass; web 725/725; browser 8/8; API all pass except `report-workspace` "collects one 365-day snapshot", which fails only while it is before 02:00 in Pacific/Auckland (the capture refuses earlier hours); rerun after 13:00 UTC pending. Three hand-built test modules were updated (promo codes, platform support, organization lifecycle).

**Step 3, rehearsal on a scrubbed copy of Empire's data (local, not on the live host).** The live host has about 1 GB RAM (about 0.4 GB free) and one CPU, so a second copy there was ruled out. A read-only `pg_dump` (22 MB) was restored into a throwaway Postgres, every guest name, email, phone, address, free-text field, log payload and staff address was replaced, and the Clock/PokPay credentials were blanked, so the copy cannot reach Clock, PokPay or mail. The live database had 105 migrations applied; the redesign adds 68 more (173 in total) and all applied on it with row counts unchanged (676 bookings, 204 guests, 38 payments, 150 rooms). Owner and staff were logged in through the redesign web: 24 and 22 dashboard screens loaded with no page errors. Findings:

- The Clock-dependent calendar and inventory show "Synchronizing / Updating" because the connection is blanked. The same will happen on cutover until the first Clock sync of the scoped snapshots finishes: plan a sync warm-up and check before announcing.
- `GET .../pms-connection-status` answers 500 when stored credentials cannot be decrypted ("Invalid authentication tag length"). Caused by the scrub, but a robustness gap: it should report "reconnect needed".
- Payments "Outstanding" is EUR 4,197,807.84 because Empire's own Clock data holds large bookings created 2026-10-25 (for example CLOCK-15926 at 148,292.10). Data, not code; ask the hotel.
- The staff user gets 403 on `support-sessions` (expected for staff).
- **Rollback is not just old code.** Among the 68 new migrations, `20261017100000_staff_access` deletes and remaps capability keys (`bookings.manage`, `guests.manage`, `staff.invite`) and `20261026040000_promo_uses_from_bookings` drops a column, so the previous release cannot run on the upgraded database. A rollback is: redeploy the previous images and restore a dump taken just before the switch (bookings made in between would have to be re-synced from Clock). The live host has no automatic backups (owner's boss is handling that), so take a manual `pg_dump` immediately before the switch.
- Not covered: anything that needs the real Clock login, including the permissions panel on Empire (gate step 2).

## Done when

Everything above is Done or explicitly deferred with a reason, the owner has signed off, and the live site runs the new build with Empire verified.
