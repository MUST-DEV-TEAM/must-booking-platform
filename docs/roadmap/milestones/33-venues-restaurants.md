# Milestone 33: Restaurants and other venues as their own business

Status: **Opened 2026-11-09. The owner Q&A comes first; no tasks are defined until it is done.** Stage 1 of the restaurant module is already live (2026-11-04).

## Goal

A restaurant is its own business inside MUST, separate from the hotel, and can be connected to a hotel when it belongs to one. The word **venue** is the shared name for any place guests book or use: a restaurant now, a beach area or a spa later (milestones 34 and 35).

## What exists today (verified 2026-11-09)

- A venue is its own model, **not** a hotel property. It may link to a hotel of the same workspace or stand alone. See [ADR-0039](../../decisions/ADR-0039-restaurant-venues.md) and [data and access](../../architecture/data-and-access.md#restaurant-venues-stage-1).
- Built and live (PRs #431, #432, #442): areas, tables, table combinations, floor map, venue staff (waiter and restaurant manager roles), reservations, deposits, sandbox deposits, available on every plan. Only a workspace owner or admin can change a restaurant's hotel link (since 2026-11-09).
- Not built: individual table deposit overrides, the waiter service-mode screen, public guest change or cancel links, slug-based restaurant resolution, the hotel confirmation email link.

## Owner decision (2026-11-09)

From now on a restaurant is treated as its own property-like unit, separate from the hotel, with a way to connect the two. That is the direction of ADR-0039; this milestone makes it complete (own dashboard area, own guests and reports, own public booking page) and defines the connection.

## Step 1: owner Q&A

A long question round on what the restaurant should be in the end (guests, booking rules, deposits and payments, staff and shifts, menus, opening hours and special days, reports, the connection to the hotel, a public page or widget, plans and pricing, languages, emails and messages). Answers are recorded in this file, then the task list is written. Status: **pending**.

## Tasks

None yet. Defined after the Q&A.

## Related

[Milestone 34](34-beach-management.md) and [35](35-spa-pool-services.md) reuse the venue idea. [Milestone 32](32-empire-astro-website.md): Empire's Sanur page. [Milestone 25](25-native-pms.md): hotel guest and stay money, which a hotel-attached venue may share.
