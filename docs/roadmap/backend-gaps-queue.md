# Backend gaps queue (after Settings redesign, PR #587)

Written 2026-11-23. One task = one branch = one pull request, in this order. One agent at a time.

## Rules for every task

- Start from `origin/main`. Read `AGENTS.md` first. Change only the files of the task.
- Every rule that a browser form and the server both apply is written once in `packages/domain-contracts` and imported by both. No copy in the web app.
- Migrations: additive, safe to run twice, with a rollback note at the top. The file name must be **later than `20261123160000`** (the newest one already live).
- New gap IDs start at **G-104** (check the log first; never reuse one). Every gap found while building goes into `docs/audit/hardening-gaps-log.md`.
- Tests run against the real database. Use the **Must Hotel** sandbox only. Empire and Luxury are read-only.
- Before reporting: `npx tsc -p tsconfig.build.json`, eslint on changed files, every spec of each touched service, then the full suite in the isolated CI replica (see the memory note on it). Web tests run from an uppercase drive path (`C:\...`).
- Do not push, merge or deploy. Do not commit unless the owner says so. Use scoped commits (pathspecs).

---

## T0. Finish on-request confirmation (G-97 item 1)

Branch: `feat/booking-rules-deferred` (Codex, commit 39e1620d). Already rebased on main.

**2026-11-24:** In progress. Acceptance saves the configured payment deadline and emails a durable link; provider checkout creation runs outside booking locks. Room holds, expiry and reminders use that deadline. Replica tests cover cancellation, races and provider confirmation. A fresh checkout cannot start in approximately the final 32 minutes before the deadline because sessions must last at least 30 minutes. Uncertain provider creation is blocked. Full API and web suite attempts stopped without summaries after worker failures under low virtual memory; rerun both. No live provider test has been made.

**Scope (fix list):**
1. Rename the two migrations to a date after 20261123160000 (for example `20261124100000_on_request_status`, `20261124100100_on_request_sweep`). Keep the same content.
2. A guest or staff member must be able to cancel a request that is still waiting. Today the state machine has no path from `ON_REQUEST_PENDING` to `CANCELLED`, so a waiting request can only be declined by staff or time out. Add the path and release the held room.
3. Status lists that were missed: `apps/web/app/dashboard/reservations-page.tsx` (~line 847, a declined booking still counts as live), `apps/web/lib/reservation-display.ts`, `apps/api/src/platform/console/platform-hotels.service.ts` (~line 500), and the report metrics. Search the whole repo for `'CANCELLED', 'EXPIRED'` and decide for each place.
4. Fix the broken character in the G-97 row of the gaps log ("Items 2?4" should read "Items 2 to 4").
5. The payment provider is called while the booking rows are locked (up to 30 seconds). Move the call outside the lock, or write the reason in the log if it stays.

**Files to read:** `local-pms.provider.ts` (`decideOnRequest`, `expireOnRequest`), `multi-room-booking.service.ts`, `booking-state-machine.ts`, `payment-expiry.service.ts`, `test/on-request-booking.e2e.spec.ts`.

**Shared rule:** the list of statuses that hold a room, and the list that do not, must exist once (`LIVE_STATUSES` in `booking-search.ts` is the start) and every query uses it.

**Tests to add (real database):** accept twice (second call changes nothing, no second payment link); decline then accept (refused); accept after the deadline (refused); accept and the automatic decline at the same moment (exactly one wins, the room is released once); guest cancels a waiting request (room released); a declined booking is absent from the live list and from reports; the accepted booking's payment confirms through the PokPay poll and the Stripe webhook.

**Rollback:** do not deploy the code without the migrations. After deploy, to stop the feature set every hotel back to instant confirmation and resolve any waiting request first. The new enum values stay in the database.

---

## T1. Staff override when changing a booking (G-97 item 2)

**Scope:** the same "skip the hotel's own limits with a reason" that exists for new staff bookings must also work when a booking is amended and when a room is moved. Same reason length (5 to 300 characters). Skipped rules and the reason go to the audit log (`booking.rules_overridden`). Availability, capacity, past dates, overlaps and per-date restrictions are never skipped. Guests never can.

**Files to read:** `apps/api/src/booking/property-booking-limits.ts`, `local-pms.provider.ts` (amend and `MoveBookingRoomCommand` paths), `booking.controller.ts`, the staff override code from S4f (search `rules_overridden`), `apps/web/app/dashboard/reservation-detail.tsx`.

**Shared rule:** which rules can be skipped, and the reason limits, in `packages/domain-contracts` (reuse the S4f definition, do not copy it).

**Tests:** staff amend with a reason skips a limit and writes the audit entry; without a reason it is refused; a guest cannot send the override; capacity and overlaps are still refused with a reason.

**Rollback:** no migration expected. Revert the pull request.

---

## T2. Gap-night filling in the booking check (G-97 item 3)

**Scope:** when "fill gap nights" is on, a stay shorter than the minimum stay is allowed only if it fills the whole free gap between two bookings or blocks. Everything else keeps today's rule. The "try a booking" box on Booking rules shows the same answer.

**Files to read:** `apps/api/src/tenancy/booking-rules-evaluation.ts` (already loads the overlapping bookings), `property-booking-limits.ts`, the Booking rules page and its try-a-booking box.

**Shared rule:** one function "does this stay fill a gap" in `packages/domain-contracts`, used by the server and the try-a-booking box.

**Tests:** exact fit allowed; one night too short or too long refused; a declined or cancelled booking does not count as a neighbour; switch off means no change; connected-PMS hotels stay locked.

**Rollback:** no migration. Revert the pull request.

---

## T3. G-102: children exempt and maximum nights on taxes and fees

**Scope:** two new fields on a charge: "children under age X are exempt" (0 to 17) and "charged for at most N nights". Add the display setting for how prices are shown. Enable the two fields on the Taxes and fees page (today "Coming soon"). The Clock part (G-63) is a **separate read-only check** done at the end and written in the log, not built here.

**Files to read:** `apps/web/app/dashboard/taxes-fees.tsx`, `apps/api/src/tenancy/pricing-evaluator.ts`, the charge model in `schema.prisma`, `quote.service.ts`.

**Shared rule:** the charge evaluator (who pays, for how many nights) lives in `packages/domain-contracts` and is used by the editor's example price, the quote and the booking total. They must give the same number.

**Tests:** child exactly at the age (exempt or not, decide and test the edge), tax capped at N nights, a stay shorter than N, existing charges unchanged, example price equals the real quote.

**Rollback:** nullable columns with no default behaviour change. Revert the code; leave the columns.

---

## T4. G-103: Settings overview from one request

**Scope:** `settings-summary` returns taxes, team, plan and last change, with the same permission checks as the four separate requests. Remove the four requests from `settings-overview.tsx`. A viewer without permission still sees a dash.

**Files to read:** `apps/web/app/dashboard/settings-overview.tsx`, the `settings-summary` endpoint, the four endpoints it replaces.

**Shared rule:** none new; reuse each endpoint's existing permission.

**Tests:** each permission combination returns or hides the right value; the overview makes one request.

**Rollback:** additive fields. Revert the pull request.

---

## T5. G-99: one page for payment timing

**Scope:** the first payment reminder is edited on Payment methods, next to link validity and the second reminder. The Emails page shows a link to it instead of its own field. One writer, same stored value, so the reminder sweep keeps working.

**Files to read:** `hotel-settings.ts` (`paymentChangeProblem`), migration `20261027040000` (`payment_link_reminder_candidates`), the Payment methods page, the Emails page.

**Shared rule:** link validity must be longer than the first reminder, and the first reminder before the second (already in `payment-rules.ts`; extend it).

**Tests:** save from Payment methods changes what the reminder sweep sends; an invalid combination is refused by the server; existing values show unchanged.

**Rollback:** no data move. Revert the pull request.

---

## T6. G-93, part 1: audit log cannot be changed or deleted

**Scope:** the database refuses UPDATE and DELETE on `audit_logs` (trigger). Viewing the log needs a new `audit.view` permission instead of `staff.manage_permissions` (decided 2026-11-18); owners and admins get it by default. No IP or device is stored (decision D125 stays).

**Files to read:** migration `20261020050000_platform_direct_access` (the existing insert trigger), `audit-log.controller.ts`, the permission catalog.

**Shared rule:** the permission catalog entry is shared with the Team permissions screen.

**Tests:** update and delete both fail, including for the app database user; owner and admin can view; a user with only `staff.manage_permissions` can no longer view; any job that purges old rows (search first) still works or is listed in the log.

**Rollback:** drop the trigger. Keep the permission.

---

## T7. G-93, part 2: every write records an audit event

**Scope:** a test that lists every write endpoint and fails when one has no audit event and no written reason. Fix the endpoints it finds that matter (money, access, settings); list the rest in the gaps log.

**Files to read:** `audit-event.ts`, `audit-log.service.ts`, controllers with `@Post`, `@Patch`, `@Put`, `@Delete`.

**Tests:** the coverage test itself, with a short allowed list that has a reason for each entry.

**Rollback:** none (test and small additions).

---

## T8. Team backend, part 1: separate permissions (G-90, G-68)

**Scope:** add `emails.manage` and `integrations.manage` to the permission catalog. Emails endpoints and integration key endpoints use them instead of `settings.manage`. Owners and admins get both by default so nothing breaks. The Team screen shows them.

**Files to read:** the permission catalog, `apps/api/src/tenancy/email-*.controller.ts`, `apps/api/src/integrations/*.controller.ts`.

**Tests:** a user with only `settings.manage` is refused on both; owner and admin still work; existing staff roles keep their effective access through the default grant.

**Rollback:** revert the pull request; the catalog entries are harmless.

---

## T9. Team backend, part 2: last sign-in (G-88)

**Scope:** record the last sign-in time per staff user; return it in the staff list; flag accounts unused for 90 days.

**Files to read:** the sign-in service in `apps/api/src/auth`, the staff list service, `schema.prisma` user model.

**Tests:** sign-in updates the time; failed sign-in does not; list shows it; 90-day flag.

**Rollback:** nullable column. Revert the code.

---

## T10. Team backend, part 3: invitations in the database (G-85)

**Scope:** invitations are stored in a table (pending, accepted, expired, withdrawn) instead of only Redis. List them, resend, withdraw. The 7-day validity stays. Old Redis invitations keep working until they expire.

**Files to read:** `apps/api/src/tenancy/staff-invite.service.ts` and controller, the staff page.

**Tests:** create, list, resend (new link, old link stops), withdraw (link stops), accept, expiry, a Redis-only legacy invitation still accepts.

**Rollback:** the table stays; revert the code to read Redis only.

---

## T11. Team backend, part 4: ownership transfer (G-87)

**Scope:** the owner picks an admin; the admin accepts by email; both are notified; audit entry; the old owner becomes admin. Exactly one owner at all times. Needs its own review because it changes who controls the account.

**Files to read:** `admin-staff.service.ts` (the line that refuses owner changes), the email outbox, the Team page.

**Tests:** accept completes the transfer; decline or expiry changes nothing; two transfers at once, only one wins; the new owner can do owner-only things, the old one cannot.

**Rollback:** transfers are one-way for the data; document how support reverses one by hand.

---

## Not in this queue (blocked or deferred)

- **S7b, payment methods applied to bookings (G-100, G-46, G-51):** decisions given by the owner 2026-11-23: refuse a method that is on but not connected (after a read-only live count); an expired balance link only tells staff; the confirmation email gets the reception line; websites get an ordered list plus a default. Ready to be sliced into tasks. Plan: `settings-s7b-payment-methods-apply-plan.md`.
- **Cancellation policy library (G-98, S5b):** decisions given by the owner 2026-11-23: all five proposals in the plan accepted (Standard keeps today's full-stay rule, one policy per distinct hours value, no-show only shown to staff, prepayment is a later step, Clock hotels read-only). Ready to be sliced into tasks. Plan: `settings-s5b-cancellation-policies-plan.md`.
- **Ages priced by age in quotes (G-97 item 4):** needs a decision on how a child's price depends on age (is there a child price table yet?). Do not start before that.
- **Two-step sign-in (G-89), logo upload (G-94), integrations G-66 to G-74, "Request an integration" endpoint (G-101):** later.
