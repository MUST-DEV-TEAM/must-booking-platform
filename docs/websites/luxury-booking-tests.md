<!-- Copy of the Luxury Premium Finese website file docs/BOOKING-TESTS.md, taken 2026-11-09. The scripts it names (scripts/mock-must.mjs, scripts/test-booking-rules.mjs) live in that repository. -->

# Booking rules: test plan

What the booking system can refuse, in the order we test it, and what the website must do each time.
The rules come from Must-Booking (`apps/api/src/booking/inventory-restriction-rules.ts` and the Clock availability reasons).

## How the tests run

| Level | What it checks | How |
| --- | --- | --- |
| 1. Rules in the pretend system | The website shows and enforces every rule | `node scripts/test-booking-rules.mjs` (starts `scripts/mock-must.mjs` and a copy of the site on port 4330) |
| 2. The real sandbox | The real booking system and the hotel software agree | Needs the same rules set in the sandbox (see below), then the same cases by hand or with the same script pointed at it |

Each case is tried three ways: the rooms list, the room page ("Available Rates" panel), and a booking forced straight at the site's API (skipping the page, as a bot or an old tab would).
A refused stay must (a) not offer "Book this rate", (b) say why in plain words, (c) be refused by the API even when forced.

## The rules and what the guest sees

| Rule | Reason code | Message (room page) | Suggests other dates? |
| --- | --- | --- | --- |
| Sold out | `sold_out` | "This room is sold out for your dates." | Yes, nearby dates |
| Minimum stay | `min_stay` | "This room needs a longer stay for these dates." | No (same length cannot help) |
| Maximum stay | `max_stay` | "This room needs a shorter stay for these dates." | No |
| Closed to arrival | `no_arrival` | "... cannot be booked to arrive on your check-in day." | Yes |
| Closed to departure | `no_departure` | "... cannot be booked to leave on your check-out day." | Yes |
| Stop sell (blocked night inside the stay) | `closed` | "This room is closed on some of these dates." | Yes |
| Too many guests | `capacity` | "This room is too small for your group." | No |
| Same-day booking closed | `same_day_closed` | "This room is closed for same-day booking." | Yes |
| Too far ahead | `too_far_ahead` | "These dates are not open for booking yet." | Yes |
| Check-in in the past, check-out before check-in, over 30 nights | (website) | Message above the dates | No |

When every room is refused for the same rule, the rooms list names the rule ("These dates need a longer stay") instead of "fully booked".

## Order of the tests (all in `scripts/test-booking-rules.mjs`)

- **A. Basics**: ordinary stay, one night, past date, check-out before check-in, same-day, the longest allowed stay and one night over, more than 30 nights, too far ahead.
- **B. Guests**: exactly the room's limit, one over, for each room type.
- **C. Minimum stay**: one short, exactly the minimum, the rule counted from the arrival day (arrive before the period and stay into it; arrive on the last day of it), and a second period with a different minimum.
- **D. Closed to arrival / departure**: arrive on the closed day, stay overnight through it (allowed), leave on a closed departure day, stay through it (allowed), arrive on it (allowed).
- **E. A blocked night**: a stay that includes it, starts on it, ends the morning of it, starts the morning after it, a short stay next to it (too short for the minimum), a longer stay that would run into it, another room type that is not blocked, a block in the middle of a long stay.
- **F. Sold out**: all rooms, a stay that runs into the sold-out period from either side, one room type only.
- **G. Rooms list**: with one room refused and others open, each room is shown on its own; when all are refused for one rule, the page names it.

## Setting the same rules in the real sandbox (level 2)

The sandbox hotel is connected to the hotel software (Clock), so these rules come from Clock, not from Must-Booking's own Inventory screen (which is switched off for Clock hotels). Set them in the Clock sandbox: minimum stay, closed to arrival/departure, stop sell, on the same dates as the plan, then run the cases.
Maximum stay, the advance limit and same-day cut-off are Must-Booking "Booking rules" settings (Settings > Booking rules).

## Results so far

See the last run of `node scripts/test-booking-rules.mjs`. Earlier manual tests on the real sandbox: sold-out, past dates, wrong price, unknown room, too many guests (found and fixed: the system accepted 4 adults in a 2-person room).
