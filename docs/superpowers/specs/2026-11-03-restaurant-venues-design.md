# Restaurant venues (table reservations) - design

Status: draft for owner approval. Date: 2026-11-03. Built locally on a feature branch; nothing is pushed, merged or deployed until the owner says so.

Marked **(owner)** = decided by the owner in the brainstorm. Marked **(my call)** = proposed by Claude, open to change.

## 1. Intent

A restaurant today takes bookings by phone, WhatsApp, walk-in and word of mouth, with no system. Nobody has one reliable answer and staff ask several people about a booking. We add a **Dining** capability: a restaurant (a **venue**) can define its areas and tables, take table reservations from any source, collect deposits and apply cancellation rules, and expose availability and booking through a public API so any website can sell tables.

The first customer is a restaurant **attached to a hotel** that already uses Must-Booking. A **standalone** restaurant (no hotel) is the second target and must stay possible: the design must not require a hotel anywhere. **(owner)**

## 2. Goals, non-goals, anti-goals

Goals
- One source of truth for every table reservation, whatever channel it came from. **(owner)**
- Venue -> areas -> tables with a drag-and-drop floor map per area. **(owner)**
- Staff-configurable services, dining durations, pacing and online rules, with sensible defaults. **(owner, defaults my call)**
- Booking policy (deposit, refund tiers, no-show, changes) configurable at venue, area or table level; most specific wins. **(owner)**
- Public, versioned, documented REST API for availability, booking and guest self-service. **(owner)**
- Works on a tablet or phone for restaurant staff, with a role limited to the venue. **(owner)**
- Hotel link: reservation tied to the shared guest profile; in-house guests tagged with room and stay dates. **(owner suggested "similar to the booking standalone", details my call)**

Non-goals for version 1
- Embeddable widget, hosted booking page and WordPress wrapper. **(owner: API only in v1)**
- External marketplaces (two-way channel push/pull), Paysera payments, WhatsApp integration. **(owner: later)** The design must leave room: every reservation records a `source`, and payments sit behind a provider interface.
- Room charges, half-board and breakfast packages, kitchen or POS features, order taking.
- Waitlist and SMS reminders (my call: later; email reminders only if cheap).

Anti-goals (would make it a failure even if it technically works)
- Any change in behaviour for existing hotel tenants, especially live Empire. No edits to hotel booking, payment or staff tables beyond purely additive plan columns.
- Hotel concepts leaking into restaurant UI (rooms, rates, PMS) or a venue that cannot exist without a hotel.
- Double-booked tables, or a deposit taken without a matching reservation.
- Restaurant staff seeing hotel payment details or unrelated hotel guests.

## 3. Constraints and project rules

- Follow AGENTS.md. Components only: check `apps/web` shared UI first, build missing pieces as shared components, pages only compose them. Code and docs in English.
- Stack as in the repo: NestJS API with Prisma/Postgres, Next.js dashboard.
- Tenant (Organization) is the top boundary. Guests are tenant-level already.
- Every screen works for restaurants with and without a hotel.
- Local-first: develop and verify locally on a branch; no PR/push/deploy without the owner.

## 4. Concepts and data model (sketch; builder owns exact schema)

- **Venue** (new, own model, under a tenant). Name, slug, timezone, currency, address, phone, contact email, optional `propertyId` (the linked hotel; null = standalone). Not a `Property`: Property is hotel-heavy and reusing it would blur code and data. **(owner agreed to "venue"; separate model is my call)**
- **Area**: belongs to a venue (terrace, indoor hall, private room). Has a floor map canvas.
- **Table**: belongs to an area. Number/label, min seats, max seats, map position/shape, active flag, and a "can combine with" set for joining tables.
- **Service (shift)**: days, open/close, slot interval (e.g. 15/30 min). A venue open all day has one long service. Dated closures override.
- **Dining duration rules**: by party size, overridable per area; staff can extend a single reservation. Defaults (my call): 1-2 guests 90 min, 3-6 120 min, 7+ 150 min.
- **Pacing**: optional max covers per slot (my call, per service).
- **Online rules**: how far ahead, last booking time before a service, max online party size, per-service on/off for online sale.
- **Reservation**: venue, guest (tenant guest profile), party size, start, end, assigned table(s), status (requested, confirmed, seated, completed, cancelled, no-show), `source` (staff, phone, walk-in, whatsapp, word-of-mouth, website, api, later: marketplace names), notes (allergies, occasion), created-by, version for optimistic concurrency, history/events (like `BookingStayEvent`).
- **Booking policy** (see 5). Attached at venue, area or table; resolution = table, else area, else venue.
- **Venue staff assignment and role templates**: equivalent of the property ones (same shape, own tables). **(owner chose equivalent over generalising; I agree: do not touch live hotel tables)**
- **Venue payments and payment sessions**: equivalent of Payment / PaymentProviderSession, linked to a reservation, reusing the existing provider adapters (PokPay, Stripe) behind one shared interface so Paysera can be added later as a provider. **(owner: equivalent; shared interface is my call)**
- **Venue payment settings**: own provider settings, with an option "use the hotel's account" for linked venues. **(my call; owner said "however you want")**
- **Plan**: add a dining on/off flag and a max-venues limit, default off / 0 so existing tenants are unchanged; platform admin enables per plan. **(owner: "what you suggest")**

## 5. Booking policy (the "richer policy") **(owner)**

One policy object, configured once, applied automatically. Fields:
- Deposit: none, percentage, or fixed amount; per booking or per guest; optional minimum party size so only large groups pay.
- Refund schedule: ordered tiers by time before the reservation (e.g. 100% until 48h, 50% until 24h, 0% after). "Always refund" and "never refund" are special cases.
- No-show: keep the deposit, or charge a fee.
- Changes: whether the guest may change date/time, until how many hours before, and how many times.
- Staff override on a single reservation (waive deposit, force refund, adjust).
- The policy that applied is **snapshotted onto the reservation** at booking time, so later edits never change an existing booking's terms (my call, industry standard).
- **Confirmation (owner):** no deposit -> the reservation is confirmed immediately, no staff approval. Deposit due -> the table is held pending payment and the reservation is confirmed only once the guest has paid. Staff-created reservations follow the same rule unless staff waive the deposit. There is no approval step in v1.
- Deposit collection by online payment holds the table for a pending window (reuse the existing hold-minutes concept); expiry releases the table. Card-on-file holds are out of scope for v1 (my call).

## 6. Availability rules (core correctness)

- A table is occupied from reservation start to start + dining duration. Overlap on the same table is rejected transactionally (database-level guard plus service check), including under concurrent requests.
- Party size must fit the table's min/max, or a valid combination of combinable tables.
- Availability for a given date, time and party size returns bookable slots after applying services, closures, pacing, online rules and existing reservations.
- Staff can book outside online rules (e.g. a party over the online max).
- Hold, confirm and cancel are idempotent (Idempotency-Key, as in the hotel API).

## 7. Public API v1 (versioned, documented) **(owner)**

Document it like `docs/architecture/public-guest-api.md`, versioned under a path prefix (e.g. `/v1/...`), with rate limits matching the hotel mutation limits. Endpoints (names are a sketch):
- Venue info and online rules (name, areas visible to guests, policy summary shown to guests).
- Availability: date, party size, optional area -> slots.
- Create reservation: details, optional area preference, idempotent; returns deposit due and checkout URL when a deposit applies.
- Read reservation (session or token).
- Guest manage link: GET/POST with a signed token, same pattern as the hotel manage endpoints; cancel or change per the policy snapshot, refunds applied automatically.
- Tenant/venue resolution via slug; no WordPress-specific logic. The manage link points at the venue's configured website origin, falling back to the dashboard link.

## 8. Staff experience **(owner: tablet/phone friendly)**

- Venue switcher or entry for restaurant staff; role limited to the venue.
- Day view: reservations list and floor map with table status (free, reserved, seated, finishing).
- Fast add: phone, walk-in or any source, with `source` selection; guest lookup by email/phone against the shared profile.
- Setup screens: venue, areas, tables and map editor, services, durations, rules, policies.
- Reservation detail: guest, notes, policy snapshot, payments, history, actions (seat, complete, cancel, no-show, move table, change time).
- Built from existing shared components; any new component is added to the shared set.

## 9. Hotel link and guest visibility

- Venue may link to a hotel property. If linked, an in-house guest (matched on email/phone to a booking with stay dates covering the reservation) shows a tag: room and stay dates on the restaurant side. The guest's hotel profile shows their table history.
- The hotel booking confirmation email gets a "Reserve a table" link with name/email prefilled and stay dates shown. Nothing is held automatically. **(owner asked for my suggestion; this is it)**
- Restaurant role sees name, phone, stay tag, allergies and notes only, never hotel payments or booking financials.
- **Decision (owner): the guest-visibility setting is deferred to stage 5 (after the restaurant works).** In v1 the venue reaches guests only through its own reservations, and existing hotel guest screens are untouched.
- Guest visibility setting **(owner asked, design my call; stage 5)**: tenant setting "share guest profiles across properties and venues", default off. When off, staff see only guests with a booking or reservation at a property/venue they are assigned to; visibility is derived from bookings and reservations (no duplicate guest records). When on, all tenant guests are visible. This applies to hotel properties as well, so it needs care around existing guest screens.

## 10. Delivery order (my call, owner can reorder)

1. Venue, areas, tables, floor map, venue staff role and plan flag.
2. Services, durations, availability engine, staff reservation screens (any source).
3. Booking policy, deposits, refunds, payments through the provider interface.
4. Public API v1 with documentation and guest manage link.
5. Hotel link (in-house tag, email link, guest visibility setting).
Later: widget/hosted page/WordPress wrapper, marketplaces, Paysera, room charge, packages, waitlist.

## 11. Left to the builder

Exact schema and migrations, DB constraints for overlap, API naming and error shapes, map editor library choice (suggest a library before building custom, per owner preference), how email reminders are done, test strategy within the repo's conventions, and the exact mechanics of the guest-visibility filter in existing queries.

## 12. Decisions still open

- Venue payment account: separate vs "use the hotel's" is supported; which is the default is my call (default: use the hotel's account when linked).
- (Resolved: guest-visibility setting is stage 5 only; confirmation is automatic, deposits confirm on payment.)
