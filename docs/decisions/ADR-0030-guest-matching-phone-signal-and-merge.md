# ADR-0030: Guest matching extended to phone; suspected-duplicate flag and manual merge

Status: Accepted
Date: 2026-09-10

## Context

Clock's integration team raised duplicate guest profiles as a real problem on the 2026-09-10 call: a guest booking again — even with the same email and phone — sometimes ends up as a second, unrelated profile rather than being recognized as the same person.

`ADR-0015-guest-matching-rule.md` (Milestone 4) deliberately limited matching to exact email only, storing phone as informational/contact data but never using it to match or merge. That decision's own "Alternatives considered" section explicitly rejected email-OR-phone matching, reasoning that a shared or reissued phone number (couples, families, reassigned mobile numbers) risked silently merging two different people's booking history onto one guest record — worse than occasional duplicate records for the same person. ADR-0015 also left the door open for later: *"Staff-facing manual merge... is out of scope for this milestone and is not blocked by this decision — it can be added later as an additive admin action without changing the matching rule itself."*

This ADR is that later point. The owner's brief for the fix (2026-09-10): match on **both** email and phone → treat as the same guest directly. Match on only **one** of the two → raise it as a possible duplicate for a human to review, not an automatic merge. Match on **neither** → a genuinely different guest. This ADR settles the exact mechanics of all of that, on both sides — MUST's own database and Clock itself.

**Scope note (extends the original 2026-09-10 brief)**: the local-only matching below is necessary but not sufficient — MUST's own duplicate-prevention means nothing if Clock still creates its own separate guest profile every time, since today's booking payload only ever sends inline `guest_e_mail`/`guest_first_name`/`guest_last_name` fields and lets Clock do whatever it does with them internally (per `docs/CLOCK_DATA_MAPPING.md`: *"No Clock-side guest id is stored or reconciled... never created as a standalone Clock guest via a separate call"*). Clock's own API turns out to fully support avoiding this: `GET /guests/search?free_text_search=...` (searches email, phone, first/last name together — Clock's own docs confirm this) and, on `POST /bookings/`, passing `main_booking_guest: "<existing guest ID>"` at the top level (outside the `booking` object) attaches the reservation to that existing Clock guest profile instead of creating a new one — this exact mechanism is documented by Clock under "Creating a booking for a returning guest." So this ADR's matching rule is applied identically on both sides: MUST's own guest table, and Clock's.

## Decision

**1. Matching at booking time** — applies to **every property, Clock-connected or not**. `ClockBookingService.resolveGuest` and `LocalPmsProvider.resolveGuest` are today two separate implementations of the identical email-only lookup (ADR-0015 was written as the general local-matching rule, not a Clock-specific one, so its supersession here is general too). Both extend the same way:

- Incoming email and phone **both** match the same existing guest → attach to that guest, same as today's behavior (this is not new — email alone already causes reuse under ADR-0015; phone corroborating it changes nothing observable).
- Incoming email matches an existing guest, but the incoming phone either doesn't match that guest's phone or the guest has none on file → still attach to that guest (unchanged from today) — a guest legitimately updates or adds contact details over time; this is not a duplicate signal.
- Incoming phone matches an existing guest's phone, but the incoming email doesn't match any guest (or matches a *different* guest) → **new behavior**. Do not silently attach the booking to the phone-matched guest (a shared/reissued phone number is exactly the false-positive ADR-0015 already rejected), and do not block booking creation on it either — booking creation must never depend on a human resolving a data-quality question. Create/attach the guest exactly as today's email-first rule would, but additionally record a **suspected-duplicate flag** pointing at the phone-matched candidate, surfaced to staff for review.
- No email match and no phone match anywhere → create a new guest, unchanged.

This keeps ADR-0015's core guarantee (booking creation is never blocked or made ambiguous by matching) while closing the gap that caused real duplicates: a returning guest whose email changed (new device, typo, different address) but whose phone is the same real number now gets flagged instead of silently multiplying into a fresh, disconnected profile.

**2. The same lookup, against Clock** (`ClockBookingService.attachRealReservation`/`createBooking`, before the `POST /bookings/` call): call `GET /guests/search?free_text_search=<email>` and, separately, `...free_text_search=<phone>` — `free_text_search` is a single fuzzy field, not separate exact-match params, so results must be filtered client-side for an actual exact match on `e_mail` or `phone_number` before treating anything as a hit. Apply the identical three-way outcome as point 1:

- Both email and phone match the same Clock guest (`family_id`) → pass `main_booking_guest: "<that family_id>"` on the booking create request instead of the inline `guest_*` fields. Clock attaches the reservation to the existing profile; no new Clock guest is created.
- Only one of email/phone matches a Clock guest → same suspected-duplicate handling as point 1 (record it against the *local* guest record, not a separate Clock-side flag — Clock has no concept of "possible duplicate" to raise this against). Fall through to creating a new Clock guest for this booking, same as today.
- Neither matches → create as today (inline fields, Clock auto-creates the guest — or, if the implementer chooses, an explicit `POST /guests` first and then `main_booking_guest` referencing it, for a slightly more auditable trail; either is acceptable, decide in the PR).

This does not require Clock's external guest ID to be stored or reconciled locally (ADR-0015's deferred Milestone-10-scope item, still not being built here) — it's a lookup performed fresh on every booking, not a stored cross-reference. If that turns out to be too slow or rate-limit-expensive in practice, storing the resolved `family_id` on MUST's own `Guest` record as a cache is a reasonable follow-up, not required for this ADR.

**3. Suspected-duplicate flag**: a nullable pointer (e.g. `suspectedDuplicateOfGuestId` on `Guest`, or an equivalent small side table if a guest can accumulate more than one candidate over time — implementer's call, justified in the PR) recording which other guest record looks like the same person. Purely advisory; never changes booking/payment behavior on its own.

**4. Manual merge** (staff-triggered, from a review queue — Milestone 21 Task 4):

- Staff sees both candidate profiles side by side (name, email, phone, booking count) and **picks which one is canonical** — this is not automated. Automated canonical-selection can guess wrong (which spelling of a name is correct, which email is still live), and this is already a human-in-the-loop review step, so let the human decide.
- **Moved**: every record referencing the losing guest's id (bookings, payments, any other guest-linked row) is reassigned to the canonical guest's id, inside one transaction.
- **Merged**: canonical keeps its own field values as-is; any field canonical is missing that the losing profile has gets backfilled from the losing profile. A field canonical already has a value for is never overwritten by the merge — no silent data loss on the record staff chose to keep.
- **Not destroyed**: the losing guest record is never hard-deleted. It's marked merged (e.g. `mergedIntoGuestId` pointer, excluded from active guest search/lists) so booking and payment history stays traceable back through it — a system that accounts for real money should never make a guest record's history unreachable. (No Prisma-level `@relation` currently declares `bookings.guestId → guests.id` as an enforced foreign key, so nothing *forces* this choice at the database level — it's a deliberate policy regardless.)
- **Dismiss**: a separate "not a duplicate" action clears the flag without merging anything, for when staff confirm it's genuinely two different people (e.g. a shared family phone number) — this is the safety valve ADR-0015's original alternatives-considered reasoning was protecting.

## Consequences

- Supersedes ADR-0015's specific claim that "phone number is stored on the guest record but is never used to automatically merge or match" — phone is now a corroborating/flagging signal, though still never sufficient **on its own** to silently attach a booking to a different guest's history. ADR-0015's core email-first matching rule and its `(tenant_id, lower(email))` uniqueness are otherwise unchanged.
- New schema surface: the suspected-duplicate flag (point 3) and the merge/tombstone fields (point 4) — additive, no migration of existing guest data required.
- Point 1 being duplicated across two providers (`ClockBookingService`/`LocalPmsProvider`) rather than one shared implementation is pre-existing (ADR-0015's rule was always implemented twice); this ADR doesn't require fixing that duplication, only that both copies carry the same extended rule. Extracting a single shared helper is a reasonable cleanup at implementation time but not mandated by this decision.
- New staff-facing UI: a suspected-duplicate review queue with merge/dismiss actions (Milestone 21 Task 4).
- Guest search/lists must now exclude merged-away (tombstoned) records by default, while still resolving historical bookings/payments back to the canonical guest.
- Two extra live Clock calls per booking creation (`guests/search` by email, then by phone) before the existing `bookings/` POST — same rate-limiter budget concern already flagged in Milestone 21 Task 9 (Clock call efficiency); worth batching into a single search where possible rather than two round trips, decide at implementation time.
- When Milestone 10's Clock guest sync (still unbuilt — see `docs/CLOCK_DATA_MAPPING.md`) eventually adds Clock's own external guest ID as a matching signal, it takes precedence over both email and phone per the source brief, same as ADR-0015 already anticipated; this ADR doesn't need to revisit that.

## Alternatives considered

- **Auto-merge on phone match alone**: rejected, for the same reason ADR-0015 rejected email-OR-phone matching — a shared/reissued phone number would silently merge two different people's history. This ADR's whole point is to close the duplicate-creation gap without reintroducing that risk.
- **Block booking creation until staff resolve a suspected duplicate**: rejected — booking creation is a guest-facing, time-sensitive action; making it depend on a human clearing a data-quality flag would turn a data hygiene problem into a booking-availability problem.
- **Automatic canonical selection on merge** (e.g. oldest record wins, or most bookings wins): rejected for now — a wrong automatic pick (bad name spelling, stale email kept over a live one) is a worse outcome than the small extra step of asking staff, who are already in the review flow by definition.
