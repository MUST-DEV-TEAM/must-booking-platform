# Clock financial reconciliation — plan (2026-09-03)

The one deliberately-deferred piece of `docs/CLOCK_CERTIFICATION_GAPS_PLAN.md`. Written up for tomorrow, not attempted tonight — real payment-adjacent design work, held for a clear head per the owner's explicit call.

## What already exists (built weeks before tonight, not new)

`ClockBookingService.postDeposit` / `depositFolio` (`apps/api/src/integrations/clock/clock-booking.service.ts`) already, for real: when a guest pays through MUST (Stripe/PokPay), reuses or creates an **open deposit folio** (`GET /bookings/{id}/folios/` → find `deposit: true, closed_at: null`, else `POST bookings/{id}/folios/` with `booking_folio.deposit=true`) and posts a `credit_item` to it for the charged amount. A failure here already records a `ManualReviewItem` (which now alerts in real time, per tonight's earlier work). **This is the real money-movement path MUST already has into Clock — reconciliation is a verification layer on top of it, not a new payment flow.**

Also already real: `ManualReviewCategory.PAYMENT_BOOKING_MISMATCH` has existed in the schema since Milestone 11 (`docs/roadmap/completed/11-clock-pms-adapter-basic.md` Task 12: "schema-ready only, pending... payment sync"). Tonight's alerting work means the moment this category is ever recorded, it alerts immediately — no new alerting mechanism needed, just a real producer.

## What reconciliation should actually mean

- **A booking MUST processed payment for**: confirm the deposit folio's posted credit_item(s) sum to what MUST actually charged (the same `payments` total the dashboard already sums for the `paidAmount` column). Mismatch, or a missing/closed deposit folio where one should exist → `PAYMENT_BOOKING_MISMATCH`, flagged, never auto-corrected.
- **A booking Clock created independently** (no MUST payment): nothing to reconcile — there's no MUST-side number to compare against. Tonight's visibility feature is the complete, correct answer for this case already.

## What's missing, concretely

1. **Real credit-item shape** — `GET /folios/{id}/credit_items` (or wherever Clock's docs place it) has never been probed for real, unlike the folio object itself. Needs confirming against the sandbox before any comparison code is written — same "confirm against real, don't guess" rule as everything else this integration has followed.
2. **A proper folio data model.** Tonight's visibility feature (`bookings.clock_folio_id`/`clock_folio_balance`/`clock_folio_closed_at`) only remembers the *one* folio that last sent an update — insufficient once deposit and general folios need to be told apart reliably. Needs a real `clock_folios` table: one row per real Clock folio, tenant/property/booking-scoped, an `is_deposit` flag, balance, closed_at. Tonight's visibility feature should move onto this table rather than keep the flat columns.
3. **The comparison service itself** — fetch the deposit folio (reusing `depositFolio`'s existing lookup, not reinventing it) + its credit_items, sum, compare against MUST's own payment total, record `PAYMENT_BOOKING_MISMATCH` via the existing `ManualReviewService` on a mismatch.
4. **Scheduling** — reuse tonight's exact `upsertJobScheduler` pattern (`ClockWorkerService`'s `clock.reconciliation` queue, or a new job on it) for a daily pass over MUST-paid, Clock-attached bookings.
5. **Separate, smaller, unrelated bug**: `BookingProjectionService.list` (`apps/api/src/booking/booking-projection.service.ts`) inner-joins `guests` — any booking with no linked guest (several of tonight's Clock-hydrated bookings, when Clock hadn't captured an email) is invisible in the dashboard list entirely, not just missing folio info. Should change to a `LEFT JOIN` so a booking without a guest still shows (guest fields simply null).

## Task split for tomorrow (Claude + Codex simultaneously)

**Not fully independent** — Task C genuinely depends on Task B's schema existing, unlike tonight's three parallel tasks. Real dependency, not an artificial one.

- **Task 0 (Claude, first, quick)**: Confirm the real credit-item response shape against the sandbox (same throwaway-script pattern as tonight — see `docs/CLOCK_RUNBOOK.md` for the credential-decrypt/Digest-auth boilerplate to reuse). Blocks Task C's exact field mapping, not Task A or B.

- **Task A (Codex, fully independent, smallest)**: Fix `BookingProjectionService.list`'s inner join → `LEFT JOIN` on `guests`, so a Clock-hydrated booking with no guest still appears in the dashboard reservation list. Real e2e proof: a booking with `guest_id IS NULL` shows up in the list response.

- **Task B (Claude, foundational, blocks Task C)**: New `clock_folios` table (migration + schema.prisma), `is_deposit` flag. Migrate `ClockFolioHydrationService` (tonight's visibility feature) to upsert into this table instead of the flat `bookings.clock_folio_*` columns — keyed on the real Clock folio id, so deposit and general folios never overwrite each other. Update the dashboard display (`reservations.tsx`) to read from the new shape, showing deposit/general separately once both exist for a booking. Real e2e proof: a booking that receives updates for *two different* folios (deposit and general) ends up with two distinct rows, not one overwriting the other.

- **Task C (after Task B lands — Claude or handed to Codex)**: The actual comparison service — fetch the deposit folio (reuse `ClockBookingService.depositFolio`'s lookup) + real credit_items (per Task 0's confirmed shape), compare against the booking's real payment total, record `PAYMENT_BOOKING_MISMATCH` on a genuine mismatch. Scheduled daily via the existing `clock.reconciliation` queue pattern. Real e2e proof: a deliberately-mismatched fixture (MUST payment total ≠ posted credit_item total) produces a real, real-time alert; a matching one produces none.

## Non-goals, explicit

- MUST ever writing to `payments`/`payment_provider_sessions` based on Clock data, or vice versa (posting is already the existing, separate `postDeposit` path — this plan never touches it).
- Any automatic refund/charge/correction based on a detected mismatch. A human always decides.
- Reconciling folios for bookings Clock created independently — nothing to reconcile there by definition.
