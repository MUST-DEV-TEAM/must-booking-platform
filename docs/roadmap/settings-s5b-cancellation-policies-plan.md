# Settings S5b: cancellation and prepayment policies

Status: **shelved by the owner on 2026-11-23** (not a priority now; tracked as G-98 in the gaps log). The plan is kept as written and waits for a go. Nothing here is built. Part of [the settings redesign plan](settings-redesign-plan.md), step S5. Closes G-52, G-53 and G-54 in [the gaps log](../audit/hardening-gaps-log.md).

## What exists today (read in the code, 2026-11-23)

| Fact | Where |
| --- | --- |
| A policy is only a **name and a number of days**. The API (create, change, delete, assign) exists; **no screen uses it**. | `apps/api/src/tenancy/cancellation-policies.service.ts`; `cancellation_policies` table |
| A rate plan points to a policy (`cancellation_policy_id`) or has its own `free_cancellation_until_hours`; the hotel has a default in days (`free_cancellation_days_before_arrival`, default 21). | `RatePlan`, `Property` in `schema.prisma` |
| **A new booking freezes its terms at the moment it is made.** A database trigger copies, in this order, the policy's days, the rate plan's hours, the hotel's days into `bookings.cancellation_terms` (arrival date, cutoff time, auto-refund, policy name). They cannot be changed afterwards. Existing bookings made before 2026-10-23 have none. | migration `20261023020000_booking_terms_and_guest_requests`, trigger `capture_must_booking_terms` |
| Whether a guest may cancel online, and the refund, read the frozen terms when they exist. Only a booking without frozen terms falls back to the hotel's days or the rate plan. | `local-pms.provider.ts` (cancel window and policy lookup), `booking-requests.service.ts` |
| **Money rule today: inside the free window the penalty is nothing; outside it the penalty is the whole stay total.** No partial penalty exists. | `refundPreview` in `booking-requests.service.ts` |
| Bookings from a connected PMS (Clock) use Clock's terms, not these. | `policySource = CLOCK_PMS` |
| The no-show rule is saved on the hotel and read by nothing. | G-54 |
| The booking page text "Free cancellation up to N days before arrival" is written from the **hotel's** days, not from the rate plan's policy. | `public-catalog.service.ts:123-138` |

**Correction to G-52.** For new bookings the three sources are already combined into one frozen answer, so the guest is bound by one cutoff. What is still wrong: (1) the booking-page text can quote the hotel's days while the booking is frozen with the policy's days, and (2) bookings made before 2026-10-23 still use the older path. The fix is smaller than the gap log suggested, and the migration must not touch existing bookings.

## What we build

**A policy library on Settings, Policies** (the screen G-53 asks for), with the fields the redesign plan lists:

- Name (required, unique, up to 80).
- Refundable or non-refundable.
- Free cancellation until 0 to 365 days or 0 to 72 hours before arrival (counted from the check-in time, in the hotel's time zone).
- After that, the penalty: first night, a percentage (1 to 100), the full stay, or a fixed amount.
- No-show charge (same four choices). It replaces the unused no-show setting.
- A generated sentence "Guests will read: ..." in English and Albanian.

**One source for the rule.** The rate plan's policy, falling back to a hotel default policy. The hotel's own "free cancellation days" number goes away as a separate setting; it becomes the default policy.

**Frozen terms, version 2.** The trigger also freezes the penalty and the no-show rule. New bookings use them; refunds read them. Bookings with version 1 terms (or none) behave exactly as today (penalty is the full stay outside the free window).

## Build slices (each ends with tests and your check on localhost)

1. **S5b-1, library screen and data (saved and checked, nothing applied).** New columns on `cancellation_policies` (refundable, hours or days, penalty type and value, no-show type and value). Policy list and form on Settings, Policies; rate plan assignment stays where it is. Migration creates a "Standard" policy per hotel from the hotel's current days and assigns it to rate plans that have no policy; rate plans with their own hours keep working. Booking behaviour unchanged.
2. **S5b-2, the booking page tells the truth.** The booking-page cancellation text and the policy shown in the confirmation come from the rate plan's policy (fixes the display half of G-52).
3. **S5b-3, money.** The trigger freezes version 2 terms; the refund calculation and the staff refund preview use the penalty type (first night, percentage, fixed, full stay). Real-database tests for every penalty type and for a booking frozen before the change. This is the careful slice.
4. **S5b-4, no-show.** The no-show charge is calculated and shown to staff when a booking is marked no-show. It is not taken automatically (see decision 3).
5. **S5c, prepayment rules** (separate, after the above is checked): None, deposit %, first night, full stay at booking, or full stay N days before. It changes what guests pay at checkout, so it is its own step and also feeds the read-only table in Payment methods (S7).

## Rules I will hold to

- Existing bookings never change: the trigger already refuses changes to frozen terms.
- Every rule is written once in `packages/domain-contracts` and used by the form and the API.
- Every money path gets a test against the real database, not only mocks (G-32).
- Additive, re-runnable migrations with a rollback note. Must Hotel only for tests; Empire and Luxury are read-only.
- Clock-connected hotels keep Clock's terms. The library is shown to them as "managed in Clock" until we decide otherwise (decision 5).

## Decisions I need from you

1. **Default penalty for existing hotels.** Today it is the full stay. I propose "Standard" keeps that (penalty: full stay), so nothing changes for anyone until a hotel edits it. OK?
2. **Rate plans with their own hours.** I propose one policy per distinct value, named for example "Free until 48 hours before arrival", so nothing is lost. OK?
3. **No-show charge.** I propose it is only calculated and shown to staff, never charged automatically (your rule that saving a policy never charges a guest). Do you want automatic charging later?
4. **Prepayment as a separate step (S5c).** OK to leave it out of S5b?
5. **Clock hotels.** Show the library read-only with "Managed in Clock", because Clock decides their terms. OK?

## Not in this plan

Terms and privacy versions (S5 step 3, G-56), showing the other policies to guests (G-55), and the on-request confirmation flow (G-97).
