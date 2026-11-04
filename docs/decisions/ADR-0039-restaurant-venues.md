# ADR-0039: Restaurant venues are their own model, not hotel properties

Status: Accepted owner direction 2026-11-03
Date: 2026-11-03

## Decision

A restaurant is a **venue**: a tenant-level model with areas, tables and its own staff assignments. It is not a `Property`. A venue may link to a hotel property of the same tenant (the hotel-attached restaurant) or stand alone (no property), and nothing in the venue code requires a hotel.

Staff assignments are an equivalent of the hotel's, in their own tables (`venue_staff_assignments`), rather than a generalisation of the live hotel tables. Stage 1 gives venue staff two fixed roles, MANAGER and HOST, mapped to fixed capabilities; customisable role templates can replace them later. Payments will follow the same rule: venue payment records are separate tables over the shared provider adapters.

Plans carry `dining_enabled` and `max_venues`, both off by default, so existing tenants see no change. Booking policy (deposit, refund tiers, no-show, changes) will resolve table, then area, then venue, and is snapshotted on each reservation.

## Addendum 2026-11-04: switched on per hotel, staff roles

A hotel's restaurant is switched on in Settings → Integrations (off by default, off keeps the data) and the plan decides whether the hotel may. A restaurant has a first-time setup before online booking can open. Restaurant roles are shown as Waiter and Restaurant Manager (stored MANAGER and HOST), and staff are created like hotel staff and share its staff seats. Restaurant staff reach their hotel through the properties list, not through hotel permissions.

## Consequences

Hotel booking, payment, property and staff tables are untouched; the only change to an existing table is the two additive plan columns. The cost is some duplicated shape (staff assignments, later payments) that a future generalisation could merge. Guest profiles stay tenant-wide; a "share guests across properties and venues" setting is deferred to stage 5.

Venue access denials are not audited yet because the denial audit needs a property; venue changes are audited at tenant level.

Full design: [restaurant venues design](../superpowers/specs/2026-11-03-restaurant-venues-design.md).
