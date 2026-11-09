# Milestone 33: Restaurants and other venues as their own business

Status: **Opened 2026-11-09. Owner Q&A answered the same day; a proposed task list is below for the owner to review. Nothing is scheduled or built.** Stage 1 of the restaurant module is already live (2026-11-04).

## Goal

A restaurant is its own business inside MUST, separate from the hotel, and can be connected to a hotel when it belongs to one. The word **venue** is the shared name for any place guests book or use: a restaurant now, a beach area or a spa later (milestones 34 and 35).

## What exists today (verified 2026-11-09)

- A venue is its own model, **not** a hotel property. It may link to a hotel of the same workspace or stand alone. See [ADR-0039](../../decisions/ADR-0039-restaurant-venues.md) and [data and access](../../architecture/data-and-access.md#restaurant-venues-stage-1).
- Built and live (PRs #431, #432, #442): areas, tables, table combinations, floor map, venue staff (waiter and restaurant manager roles), reservations, deposits, sandbox deposits, available on every plan. Only a workspace owner or admin can change a restaurant's hotel link (since 2026-11-09).
- Not built: individual table deposit overrides, the waiter service-mode screen, public guest change or cancel links, slug-based restaurant resolution, the hotel confirmation email link.

## Owner decision (2026-11-09)

From now on a restaurant is treated as its own property-like unit, separate from the hotel, with a way to connect the two. That is the direction of ADR-0039; this milestone makes it complete (own dashboard area, own guests and reports, own public booking page) and defines the connection.

## Owner Q&A (answered 2026-11-09)

| Topic | Answer |
| --- | --- |
| Who uses it | All four: a hotel's own restaurant, stand-alone restaurants, several restaurants under one owner, and restaurants as their own product. |
| What guests do | Reserve a table online, join a waiting list, see the menu. (Takeaway and delivery: **not wanted** for now.) |
| Money | **Set per restaurant:** each restaurant chooses no payment, a deposit, or full prepayment. Deposits exist (stage 1); the other two modes are to add. |
| Link to a hotel | All four: offered in the hotel's booking flow, charge the meal to the room, share guest profiles, hotel staff see restaurant bookings. |
| Service day | Waiter screen, live floor map, notes on guests (allergies, VIP, preferences), table turn times and overbooking rules. |
| Opening rules | Different hours per weekday, several services a day (breakfast, lunch, dinner), seasons and special days, limits per booking (party size, how far ahead, last booking before closing). |
| Guest messages | Confirmation email, reminder (email, SMS or WhatsApp), change or cancel link, thank-you and review request. |
| Reports | Covers per day and per service, no-shows and cancellations, deposit money, guest history. |
| Where guests book | All four: a page hosted by MUST, a widget for any website, the public API ([Milestone 26](26-public-api.md)), and inside the hotel booking flow. |
| Pricing as a product | **Free for now.** The business side is decided later by the owner of the business; nothing about plans or prices is built. |
| Staff roles | A set of default roles now (as built: waiter and restaurant manager, extended as needed), custom roles with permissions later through [Milestone 30](30-permissions-rbac.md). |
| Build first | **Finish the stage 1 gaps** (waiter screen, guest change or cancel links, restaurant address by name, hotel confirmation email link). |

## Proposed tasks (drafted from the answers; not scheduled, owner to review)

**Phase A: finish stage 1 (first)**

| # | Task | Status |
| --- | --- | --- |
| 1 | Waiter screen (service mode): seat a party, arrived, no-show, finished, on the live floor map | Proposed |
| 2 | Guest change and cancel links (public, safe, with the restaurant's cancel rule) | Proposed |
| 3 | Restaurant address by name (slug) for a hosted booking page | Proposed |
| 4 | Link from the hotel's booking confirmation email to the restaurant | Proposed |
| 5 | Per-table deposit overrides | Proposed |
| 6 | Payment mode per restaurant: none, deposit, full prepayment | Proposed |

**Phase B: running a restaurant day to day**

| # | Task | Status |
| --- | --- | --- |
| 7 | Opening hours: weekdays, several services a day, seasons, special days and closures (first check what stage 1 already holds) | Proposed |
| 8 | Booking limits: party size, how far ahead, last booking before closing | Proposed |
| 9 | Table turn times and overbooking rules | Proposed |
| 10 | Guest notes (allergies, VIP, preferences) shown to staff | Proposed |
| 11 | Waiting list and walk-ins | Proposed |
| 12 | Menu shown on the booking page (read-only list of dishes and prices) | Proposed |
| 13 | Guest messages: confirmation, reminder (email, SMS or WhatsApp), thank-you and review request | Proposed |
| 14 | Reports: covers, no-shows and cancellations, deposit money, guest history | Proposed |

**Phase C: public booking**

| # | Task | Status |
| --- | --- | --- |
| 15 | Hosted booking page per restaurant | Proposed |
| 16 | Embeddable widget for any website | Proposed |
| 17 | Public API for restaurants (shared with [Milestone 26](26-public-api.md)) | Proposed |

**Phase D: connection to the hotel and several restaurants**

| # | Task | Status |
| --- | --- | --- |
| 18 | Offer a table inside the hotel's booking flow | Proposed |
| 19 | Hotel staff (reception) see and make restaurant bookings | Proposed |
| 20 | Shared guest profiles between hotel and restaurant | Proposed |
| 21 | Charge a meal to the room. Needs a decision per hotel type first: a Clock hotel such as Empire needs a Clock capability check, a native-PMS hotel needs [Milestone 25](25-native-pms.md) stay money | Proposed, blocked by that decision |
| 22 | One owner sees all their restaurants together; a restaurant area separate from the hotel dashboard | Proposed |

**Later, decided elsewhere:** custom roles with permissions (Milestone 30); plans and prices for restaurants (business decision, free for now); takeaway and delivery (not wanted for now).

## Related

[Milestone 34](34-beach-management.md) and [35](35-spa-pool-services.md) reuse the venue idea. [Milestone 32](32-empire-astro-website.md): Empire's Sanur page. [Milestone 25](25-native-pms.md): hotel guest and stay money, which a hotel-attached venue may share.
