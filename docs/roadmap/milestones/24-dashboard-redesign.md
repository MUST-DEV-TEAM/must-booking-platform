# Milestone 24: Dashboard redesign

Status: **Planning — design intake in progress (opened 2026-10-16).** No page implementation is authorized yet beyond the foundation listed below.
Supersedes the dashboard/UI tasks of [Milestone 13](13-app-ui-ux-and-features.md) (see its disposition table). Login, signup and the other auth pages are **out of scope** and keep their current design.
Related: [Milestone 25 — Native PMS](25-native-pms.md) (feature work; this milestone reserves screen space for it but does not build it).

## Goal

Replace the dashboard's look and structure with the new design, using one shared component set for the whole app. The owner supplies each page's design (screenshot or the `/design` preview); each page is planned against what the product can really show; implementation happens at the end, after every page is planned, so that components used by several pages are built once with variants instead of once per page.

## How this milestone runs

1. **Intake and plan, page by page.** The owner sends a page design. For each page this document gets: the design source, the data behind every widget, the shared components it needs, and its gaps (see the template and Page 1 below). No page code is written in this phase.
2. **Extract the shared components.** After all pages are planned, compare them: the same thing shown in different visual forms becomes one component with variants. The register below is the output.
3. **Implement.** Shared components first, then the pages, in the order recorded here.
4. **Verify.** Responsive and accessibility checks (reuse the unfinished acceptance criteria of Milestone 13 tasks 25-32: widths 390 / 768 / 1024 / 1280 / 1440, keyboard, contrast), screenshot comparison with the design, and the existing test suite.

## Decisions (owner, 2026-10-16)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Process | Owner sends designs; Claude plans per page; everything is completed at the end |
| 2 | Previous redesign milestone | Milestone 13's dashboard/UI tasks are superseded by this milestone. Non-redesign tasks stay visible on 13 (see its disposition table) |
| 3 | Start point | The Overview as designed at `/design/overview` is Page 1 |
| 4 | Do not build ahead | No page, not even the Overview, is implemented before all pages are planned |
| 5 | Native PMS | Tracked separately in Milestone 25 |
| 7 | Design supply | Owner exports PNGs from the Figma file page by page. Mobile/phone versions cannot be supplied now and are built later; until then phone layouts follow the shell's single-column stacking |
| 6 | Designed features the product lacks | Recorded in the Feature gaps register and built later; the live page omits them meanwhile |

## Planning rules

- **Design is the visual system and layout, not the data spec.** Every widget is classified **Real** (an API/table supplies it now), **Derivable** (computable from existing data with a small backend addition), or **Invented** (no data exists). Invented widgets are not built until the owner decides to fund the backend work or drop them. Never ship placeholder numbers in the live dashboard.
- **Design features we do not have are recorded, not faked.** If a design shows something the product cannot do or show yet, it goes into the Feature gaps register below with what is missing, and the live page omits it (no placeholder data, no dead controls). The owner decides when each gap is built.
- **Navigation is capability-based.** The design's role-based demo sidebar (Admin / Staff / Finance / Agent / Read-only) is not the permission model. Real access is Owner / Admin / Staff plus per-property capabilities (see `canAccessSection` in `dashboard-shell.tsx`).
- **Coexistence.** Unmigrated screens must keep working unchanged. The dashboard Tailwind entry deliberately omits Tailwind's global reset; remove the scoped reset only when every dashboard screen is migrated.
- **Auth pages untouched.** They must never load the new CSS.

## Foundation (exists in the working tree, uncommitted)

Built on branch `codex/design-dashboard-latest` while this milestone was being scoped. Evidence is code present and visually checked, not reviewed or merged.

- 20 generic components moved from `apps/web/app/design/_ui/` to `apps/web/components/ui/` (alert, avatar, badge, button, card, checkbox, dialog, dropdown-menu, input, label, popover, progress, select, separator, sheet, skeleton, switch, table, tabs, tooltip); `cn` helper at `apps/web/lib/utils.ts`. `/design` imports the same files.
- `apps/web/app/ui-theme.css` (shared tokens, themes, `.ui-root` scope), `apps/web/app/design/design.css` (preview-only), `apps/web/app/dashboard/dashboard.css` (Tailwind theme + utilities without global reset, scoped zero-specificity reset), `apps/web/app/dashboard/layout.tsx` wraps the dashboard in `.ui-root`.
- `apps/web/components/app-shell.tsx`: redesigned shell (collapsible sidebar, slide-over menu below 1024px, account menu with logout). Same inputs as the legacy `AppShell` in `@must/ui`; `dashboard-shell.tsx` now imports it. Legacy mobile bottom navigation is not carried over.
- Verified: type check clean; dashboard test suite 28 files / 180 tests passing; desktop and 390px screenshots. `/design` tests: 3 failures that already existed at HEAD (assertions expect the text "Design preview", which the shell no longer renders).
- Not yet investigated: 403/404 responses visible in the browser console when loading the dashboard as the hotel owner.

## Page intake

| Page | Design source | Status |
| --- | --- | --- |
| Overview (Dashboard) | `/design/overview` | **Design received — planned below** |
| Needs Attention (tab) | `/design/overview`, tab 2 | **Design received — planned below (1b)** |
| Quick Booking (tab) | `/design/overview`, tab 4 | **Design received — planned below (1d)** |
| Approvals (tab) | `/design/overview`, tab 3 | **Design received — planned below (1c)**; feature does not exist (gap G2) |
| System Health (tab) | `/design/overview`, tab 5 | **Design received — planned below (1e)**; feature does not exist (gap G4) |
| Bookings / reservations list | Figma PNGs (list state, search state), 2026-10-16 | **Design received — planned below (Page 2)**; owner finds it too bare, suggestions pending OK |
| Booking detail | Figma PNG, 2026-10-16 | **Design received — planned below (Page 3)** |
| Edit reservation | Figma PNG, 2026-10-16 | **Design received — planned below (Page 4)**; mostly a new backend feature |
| Cancellation request review / approval | Figma PNG, 2026-10-16 | **Design received — planned below (Page 7)** |
| Amend reservation (stay change and room move) | Figma PNG, 2026-10-16 | **Design received — planned below (Page 8)** |
| Provider synchronization review (manual review) | Figma PNG, 2026-10-16 | **Design received — planned below (Page 9)** |
| Reservations: empty, loading and error states | Figma PNG, 2026-10-16 | **Design received — planned below (Page 10)** |
| Add reservation, step 1 Stay details | none (owner: build in-house) | **Planned in-house — Page 5a** |
| Add reservation, step 2 Guest information | Figma PNG, 2026-10-16 | **Design received — planned below (Page 5)** |
| Add reservation, step 3 Payment & review | Figma PNG, 2026-10-16 | **Design received — planned below (Page 6)** |
| Calendar / availability | Figma PNG, 2026-10-16 (3 states: default, filtered, cell details) | **Design received — planned below (Page 11)** |
| Payments: Overview, Ledger, Payment detail, Create refund request, Refund review, Reconciliation, Clock folios (Gateways tab dropped, D71) | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 15 to 15i)** |
| Guests: directory, filtered directory, profile, edit, reservation history, flags and notes, states | Figma PNGs, 2026-10-16 | **Designs received — planned below (Page 16)** |
| Hotels (owner-only group view of all hotels, see D5 and D32) | — | Awaiting design |
| Accommodations: all tabs (Overview, Categories, Listings, Units, Import & Export), Create listing, Listing detail, Unit detail, Setup warnings, empty and error states | Figma PNGs, 2026-10-16 (labelled "Hotels" in the design) | **Designs received — planned below (Pages 12 to 12i)**; Photos, Rates & Pricing and Inventory pages still awaiting design |
| Photos | none (owner: no separate Photos page) | **Not designed on purpose**; photos live in the listing editor (D62) |
| Rates & Pricing: all six tabs, Create and Edit rule, Rate plan detail, states reference sheet | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 13 to 13i)** |
| Availability (the "Inventory" sidebar item): all four tabs, Create and Edit restriction, Manual Blocks list, Create and Edit manual block, Conflict Review, states reference | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 14 to 14i)** |
| Emails: Overview, Templates, Template editor, Preview, Send test email, Delivery failure incident, Configuration, states (a new sidebar item; Delivery list not supplied as its own page) | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 17 to 17h)**; implemented on top of Milestone 22 |
| Coupons: list, create, edit, usage traceability, lifecycle states, empty and error states (a new sidebar item) | Figma PNGs, 2026-10-16 | **Designs received — planned below (Page 18)**; this is the feature earlier deferred as G28 / D19 |
| Staff Users (list, access exceptions, invitation lifecycle) | Figma PNG, 2026-10-16 | **Design received — planned below (Page 22)** |
| Staff & Access (roles and permission matrix), Invite staff member | Figma PNGs, 2026-10-16 | **Designs received — planned below (Page 22f, 22g)** |
| Staff user detail, Roles list, Create custom role | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 22h to 22j)** |
| Audit event detail, Suspend staff access | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 22n, 22o)** |
| Permission matrix, User-level overrides, Activity & audit logs, Add override, Edit staff user, Audit event detail | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 22k to 22n)** |
| Settings: overview (13 areas), General, Booking rules (Payments summary, Check-in & Check-out, Staff & Access, Staff Users, Frontend & Branding, Managed Pages, Notifications & Emails, Provider, Diagnostics, Billing Account, Dangerous Reset are listed but not supplied) | Figma PNGs, 2026-10-16 | **Designs received — planned below (Page 21)** |
| Settings: Check-in & Check-out, Payments summary, Staff & Access | Figma PNGs, 2026-10-16 | **Designs received — planned below (Page 21a)** |
| Reports: all six tabs (Overview, Reservations, Revenue & Payments, Occupancy & Stay, Accommodation, Custom View) and states | Figma PNGs, 2026-10-16 | **Designs received — planned below (Pages 19 and 19a)** |
| Notifications: inbox, unread view, notification detail, states (supersedes the earlier in-house plan) | Figma PNGs, 2026-10-16 | **Designs received — planned below (Page 23, updated)** |
| Group (all-hotels) dashboard, owner only | — | Awaiting design (D5) |
| Platform admin area (`/platform`) | — | Awaiting design |
| Integrations (Overview, Clock PMS, Mapping, Sync Ops, Request Logs, Diagnostics, job detail, manual review queue, states) | Figma PNGs, 2026-10-16 | **Designs received — planned below (Page 20); owner: this is for the ADMIN dashboard, not hotel staff** |

## Page 1 — Overview

**Design source:** `/design/overview` (preview with demo data). **Current implementation:** `overview.tsx`, `dashboard-shell.tsx` tabs, API `GET` overview (`apps/api/src/tenancy/overview.service.ts`, type `PropertyOverview`).

What the API returns today: `kpis` (arrivals, departures, inHouse, bookedRoomNights, availableRoomNights, occupancyRate), `revenue.today`, `balanceDueAtDesk`, `newBookingsSinceYesterday`, `needsAttentionCount`, `needsAttention[]`, `todaysArrivals[]`, `todaysDepartures[]`, `upcomingArrivals[]`, `soldOutRooms[]`, `recentCancellations[]`, `recentActivity[]`.

| Design widget | Class | Notes / needed work |
| --- | --- | --- |
| Arrivals, Departures, In house, Occupancy tiles (incl. "62 / 84") | Real | `kpis`; "units" maps to room-nights available |
| Guest counts on tiles ("28 guests") | Derivable (unchecked) | Needs party size per booking; confirm it is stored |
| "vs yesterday", "+3.1% vs last week", 7-day sparklines | **Invented** | No daily history is stored. Needs daily snapshots or historical queries, or drop |
| Needs review tile and Needs attention list | Real | `needsAttentionCount`, `needsAttention[]` |
| Payments received (amount) | Real | `revenue.today`; the "15 payments" count would be a small addition |
| Payment follow-up (unpaid / failed / partial) | Derivable (unchecked) | From booking and payment statuses |
| Unavailable inventory "7 manual · 4 maintenance" | **Invented** | `availability_blocks` has dates and `blocks_all` only, no reason |
| Today at a glance header and quick actions | Real | Walk-in booking and calendar exist |
| Sync chips (Local, Clock "12m behind", PokPay) | Partial | Clock webhook health service exists; no PokPay equivalent |
| Recent reservations table (search, filter, source badge, room) | Real / Derivable | Reservations list exists; source badge and room need confirming |
| Recent activity feed | Real | `recentActivity[]` |
| Needs attention tab | Real | Already exists as a tab |
| Quick booking tab | Real | `WalkInBooking` |
| Approvals tab | **Invented** | No approval workflow exists (owner decision needed) |
| System health card and tab | Partial | Sources exist (Clock health, provider events, manual-review items); nothing assembles them. Owner decision: build a small version or defer |
| Sidebar: Events | **Invented** | No event feature (provider "events" are webhooks) |
| Sidebar: Invoices, Reconciliation | Becomes real in Milestone 25 | Invoices are in the native-PMS minimum scope |

**Real data the design does not show** (candidates to add): balance due at desk, sold-out rooms, recent cancellations, upcoming arrivals (7 days), new bookings since yesterday.

**Owner decisions for this page (2026-10-16)**

| # | Question | Decision |
| --- | --- | --- |
| 1 | Trends and "vs yesterday" deltas | **Plan it.** Daily history capture becomes a backend feature (gap G1). Until it exists the Overview ships without sparklines and deltas, with the tile layout keeping the slot |
| 2 | Approvals and Events | **Plan both** as future features (gaps G2, G3). Until they exist their tab and sidebar entry are not shown in the live dashboard |
| 3 | System health | **Plan it** (gap G4). Built later from existing health sources; the tab is not shown live until then |
| 4 | Unavailable inventory split | **Show a single count.** No block reason is added; the "manual / maintenance" breakdown is not built |

**Shared components this page needs** (feeds the register): stat tile (with optional delta/sparkline slot), section tab bar, data table with search/filter, status badge, source badge, list row with action chevron, activity feed item, card with header action, health row, quick-action button group.

### Page 1 — remaining Overview content and tabs (design reviewed 2026-10-16)

The Overview tab continues below the stat tiles with: Recent reservations, Needs attention card, System health card, Recent activity, Quick actions card, and a Quick booking search strip. The tab bar has five tabs. All of it is in `/design/overview`.

**Cross-cutting question (decision D5): is the redesigned Dashboard tenant-wide or per hotel?** The design is titled "Main Dashboard" and its rows mix hotels (Empire Beach Resort, Old Town Suites, Marina Bay Hotel), i.e. an all-hotels view. The real app is per property: a header property switcher, and Milestone 13 Task 8 deliberately retired the old Main Dashboard / property dashboard split. Every Overview number, queue and request in the plan below depends on this. Options: (a) per property like today, hotel name only in the header; (b) tenant-wide aggregate with a hotel column and a hotel filter; (c) both, with an "All hotels" choice in the property switcher. Needs the owner's answer before the Overview is built.

**Overview tab, remaining widgets**

| Design widget | Class | Notes |
| --- | --- | --- |
| Recent reservations (search, "All bookings" filter, View all) | Real / Derivable | Reservations list exists; see G8 for source badge and room label |
| Needs attention card (Booking review 3, Payment follow-up 4, "Open operations queue") | Real for bookings, gap for payments | See 1b |
| System health card (6 rows with Healthy / Delayed / 1 failed) | Gap | See 1e / G4 |
| Recent activity (5 events, "View activity log", "Open full activity timeline") | Real list, gap page | `recentActivity[]` exists; there is no activity log page (G13) |
| Quick actions: Review payment issues, Review provider status, Create reservation, Block availability | Real / partial | Create reservation = walk-in booking; block availability exists in the calendar for owner/admin; "payment issues" and "provider status" depend on G7 and G4 |
| Quick booking search strip (dates, room type, adults, children, Check availability) | Real | Hand-off into the Quick booking tab |

**1b. Needs attention tab** — what exists: `NeedsAttentionTab` lists bookings whose status is manual review, payment failed, availability failed, PMS rejected or PMS unknown result (`booking-attention.ts`), with guest, dates, room type. The design adds: four summary tiles (Open issues, Booking review, Payment follow-up, Urgent) that act as filters; All / Bookings / Payments chips; search; priority filter; sort; an issue table (issue type, reservation, guest, room, hotel, booking and payment badges); a selected-issue side panel ("Why this is flagged", property/room/stay/total, "Recommended next step", "Open reservation record"); "Review next". Gaps: priority levels (Urgent / Review) do not exist; payment-record issues (not received, partial, unpaid) are not part of the attention list today; recommended-next-step text and "Review next" ordering need rules (G11). Everything else is a UI restructure of existing data.

**1c. Approvals tab ("Guest requests")** — the design defines what Approvals means: guest requests such as late checkout and room change, shown with reservation context, a "before deciding" hint, View reservation, Decline and Approve request, and Awaiting / Approved / Declined counts. **No guest-request feature exists** (no table, endpoint, or guest-facing way to submit one). Needs: a guest request entity and types, how guests submit them (WordPress plugin, email link, front desk entry), approval and decline with audit and guest notification, and the permission that gates deciding (G2). Not shown live until built.

**1d. Quick booking tab** — the design is a four-step staff booking flow (Stay & rooms, Guest details, Review & payment, Confirmation) with search availability, a per-room guest composer, available room types with price per night, a booking summary, price and booking checks, individual-room assignment, and a long guest-details form. What exists: `WalkInBooking` (single-room walk-in with availability, quote, guest name/email/phone) and a staff booking API that already accepts **multiple rooms** (`rooms[]` in `multi-room-booking.service.ts`). Gaps: multi-room and per-room guests are not exposed in the UI (a UI task, backend exists, G14); **child ages, company, country, street address, address line 2 and additional guests are not stored anywhere** (G12); the 4-step review/payment/confirmation structure is a UI restructure of existing quote and payment-method logic; individual-room selection depends on property booking mode (see Milestone 10) and its UI exposure is unverified.

**1e. System health tab** — the design is a monitoring-coverage page: four monitor families (external uptime smoke test via GitHub Actions, payment provider checks cached in Redis, Clock integration watchdog, payment expiry worker), a "visibility gaps" list and recommended next steps, with an explicit note that live readings are not connected. It documents platform operations, not a hotel's property state. Hotel staff should not see GitHub Actions or Redis details. Decision D6: keep this as a **platform-admin** page (where it belongs) and give the hotel dashboard a small live signals card/tab (booking flow, payment provider, PMS connection, sync freshness, scheduled jobs) built from data that exists or is planned (G4).

**Open decisions from this review**

| # | Question |
| --- | --- |
| D5 | Dashboard scope — **Decided (owner, 2026-10-16): per single hotel.** A separate all-hotels dashboard will exist, owner-only (see detail below, gap G15) |
| D6 | System health — **Decided: yes.** Coverage content moves to the platform-admin area; hotel staff get a small live-signals card/tab |
| D7 | Guest requests (Approvals) — **Proposal accepted in effect:** the single requests-and-approvals model was approved (D24, S23) and early check-in and late check-out were approved as request types (D108). The first-version request types (late check-out, early check-in, room change or preference, other) and the staff-recorded-first arrival path stay as proposed in the detail below |
| D8 | Quick booking guest details — **Decided: owner delegated to industry standard**; spec recorded below |


#### Decisions D5-D8 in detail (2026-10-16)

**D5 — per-hotel dashboard; owner-only group dashboard**

- The redesigned Dashboard is **one hotel at a time**. Design changes required before building: the header title shows the hotel name (not "Main Dashboard"); remove hotel names and the "Room · Hotel" column from lists (Recent reservations, Needs attention, Approvals); the hotel is chosen with the header property switcher, as today. Staff only see the hotels they are assigned to.
- A second **all-hotels (group) dashboard** will be built as its own page, with a design to be supplied by the owner. **Access: tenant role OWNER only. Not Admin, not Staff.** The server must enforce it, not only hide the link (gap G15).
- Follow-up when the Hotels page design arrives: today the Hotels section is reachable by every role (`canAccessSection` lets Staff through). The new rule means the group view must be Owner-only; whether Admin keeps a plain hotel list is to be confirmed then.

**D8 — Quick booking guest details (decided, industry-standard spec)**

| Field | Rule |
| --- | --- |
| First name, last name | Required |
| Email | Required (the system stores guest email as non-null and sends confirmations to it) |
| Phone | Optional by default; make it required only if today's walk-in rule already requires it (verify during build) |
| Child ages | **Required for every child.** Child rates and capacity depend on age, which is standard in booking engines; stored per booking |
| Country (nationality / residence) | Optional at booking; stored as an ISO country code; used for guest statistics, invoices and any local registration rule |
| Company | Optional; used for corporate invoices (Milestone 25). Tax ID is decided in Milestone 25, not here |
| Billing address (street, line 2, city, postal code, country) | Optional at booking; collected when an invoice needs it. Structured fields, not one text box |
| Additional guests | Optional names at booking; full details are captured at check-in (Milestone 25 front desk) |
| Special requests, expected arrival time | Not in the design but standard in booking forms; **suggested additions**, optional free text and time |
| Identity documents | **Not collected at booking.** Check-in registration belongs to Milestone 25; local legal requirements must be confirmed there |

**D7 — guest requests (proposal, awaiting owner OK)**

Industry practice: guests ask for things beyond the room itself before or during a stay (early arrival, late departure, a different room). Hotels handle them from a requests queue, decide, and tell the guest. Proposed first version:

- **Request types:** Late check-out, Early check-in, Room change / preference (bed type, quiet room, floor), Other (free text).
- **How requests arrive:** (1) staff record a request received by phone, email or at the desk, attached to a booking — needs no guest-facing screen, so it can ship first; (2) later, a secure "manage your booking" link in the confirmation or pre-arrival email lets guests submit requests themselves.
- **Lifecycle:** Pending, Approved, Declined (optional Cancelled / Expired). Approve or decline requires a permission and a note; the guest is emailed the outcome; every decision is audit-logged.
- **Money:** late check-out and early check-in are often charged. Charging belongs to the stay folio in Milestone 25; version one records the decision without charging.
- **Where it lives:** a request belongs to a booking and a hotel; the Approvals tab lists them for the selected hotel only (D5).


## Page 2 — Reservations (Bookings)

**Design source:** two Figma PNGs: "All reservations" (list) and "Search reservations" (advanced filters). **Current implementation:** `reservations.tsx` (642 lines) over `GET /tenants/:tenantId/properties/:propertyId/bookings`. **Important:** that endpoint returns **every** booking of the property in one response; search, status filter, date filter and sorting all run in the browser (TanStack Table). The design shows server-style paging ("1-4 of 48", 12 pages), which needs a new endpoint (G16).

Fields the API returns today per booking: guest name, email, phone, address, special requests, room type, assigned room id, rate plan, start and end dates, status, PMS stay status, payment method, adults, children, total, paid amount, refunded amount, external reference (the "MHB-1088" style id), created and updated timestamps, and Clock folios.

| Design element | Class | Notes |
| --- | --- | --- |
| Title, Add reservation, Calendar view | Real | Walk-in booking and the calendar exist |
| Export list / Export results | Derivable | CSV of the filtered rows; contains guest personal data, so gate it behind a permission (G21) |
| Chips: Last refreshed, 8 need attention, 3 payments pending, 24 arrivals this week | Derivable | Refresh time from the query; attention from `needsAttentionCount`; the others are counts over bookings (payment pending needs the G18 definition) |
| Search guest / ID / hotel | Real (client-side) | Hotel part removed per D5 |
| Status filter and sort | Real | Statuses: draft, quoted, payment pending, confirmed, failed states, manual review, cancelled, expired |
| Hotel filter, Hotel column, "All hotels" | Removed | D5: one hotel at a time; the header switcher chooses it |
| Reservation / guest cell (id, phone) | Real | `externalReference`, guest phone |
| Property / room cell | Real | Room type name and assigned room; property name dropped (D5) |
| Stay / guests cell (dates, nights, "2 adults · 1 child") | Real | Adults and children are stored |
| Source / created cell (Direct, Website, OTA, Request + timestamp) | **Gap** | Created time is real; **no booking source/channel field exists** (G17) |
| Reservation badge | Real except "On request" | No "on request" status exists (G19) |
| Payment badge (Paid, Pending, Unpaid) | Derivable | From paid amount, total, status and payment method; definition needed (G18) |
| Total ("Gross total") | Real | Total and currency; Paid and refunded amounts also available |
| Pagination, rows count | **Gap** | Needs a server-side list endpoint (G16) |
| Search page: stay dates | Real (client-side) | The meaning of "stay dates" must be defined: arrival, departure, stay overlaps, or created (see S3) |
| Search page: payment status filter | Derivable | Same as G18 |
| Search page: booking source filter | **Gap** | G17 |
| Search page: booking mode filter | Drop | Booking mode is a property setting (room type only / individual rooms / mixed), not a property of a reservation |
| Search page: provider sync filter | Partial | Only meaningful for hotels connected to an external PMS (Clock stay status and sync states exist); hide it for native-PMS hotels |
| Active filter chips, "3 filters active", "8 matching results", Clear all | Real | Pure UI |

### Suggestions (industry practice) — awaiting owner OK

The owner finds the page too bare. Reservation lists in hotel PMS products are working tools for the front desk, so what the design lacks is mostly **ways to get to the right reservation fast** and **information visible without opening each row**.

| # | Suggestion | Why |
| --- | --- | --- |
| S1 | **Saved quick views as tabs with counts** above the table: Arriving today, In house, Departing today, Upcoming, Needs attention, Unpaid, Cancelled, All | The front desk's first question is "who arrives today / who is in house". One click instead of building filters |
| S2 | **Merge the two designs into one page.** The list header holds a single search box and a "More filters" panel that opens in place, with removable filter chips | A separate search page duplicates the list and forces a page change; chips make active filters visible |
| S3 | **Date filter with a type:** Arrival, Departure, Stay overlaps, Created | "Stay dates" is ambiguous; PMS lists let staff pick which date they mean |
| S4 | **More columns, shown by default and togglable:** room number (assigned), nights, adults and children, balance due (total minus paid), source, created | Staff should see money owed and the assigned room without opening the booking |
| S5 | **Row action menu (three dots)** and an optional side preview: view, edit, record payment, refund, resend confirmation, cancel. (Check-in and check-out are added when Milestone 25 lands) | Common actions without leaving the list; fewer clicks per task |
| S6 | **Checkboxes and bulk actions:** export selected, send email | Standard for lists that need housekeeping-style batch work |
| S7 | **Summary strip:** arrivals, departures, in house, unpaid balance (clickable, acts as filters) | Gives the page a "so what" at the top instead of only status chips |
| S8 | **Sticky header, row hover, density toggle, rows-per-page, empty / loading / error states** | Basic data-table quality |
| S9 | **Visible cues in rows:** unpaid balance in red, special-requests icon, "arrives today" marker, cancelled rows muted | Scanning speed |
| S10 | **Remember the user's last filters and sort** per user | Common expectation in PMS tools |

**Decisions needed for this page**

| # | Question |
| --- | --- |
| D9 | Theme — **Decided (owner, 2026-10-16):** neutral black is the default. The owner of a hotel group will be able to choose another theme in Settings (gap G22) |
| D10 | **Decided: yes, S1-S10 accepted.** Build them from the existing components; anything missing is listed in the Missing components section in plain words |
| D11 | **Decided: planned.** "On request" (hotel confirms before the booking is final) becomes a planned feature (gap G19) |
| D12 | **Decided: Direct** (created in the system by staff), **Website** (the WordPress widget or any other website using the API). **OTA is left for later**, when channel integrations exist |

## Page 3 — Booking detail

**Design source:** Figma PNG "Reservations" detail (reservation MHB-1088). **Current implementation:** a read-only detail panel inside `reservations.tsx` (guest, stay, room, status, Clock stay status, payment, reference, Clock folios, special requests). It has no edit and no move-room actions.

| Design element | Class | Notes |
| --- | --- | --- |
| Back link, reference, guest name, "Confirmed reservation · Created from website · date and time" | Real | Source wording needs G17 (Direct / Website) |
| Badges Confirmed, Paid, Clock synced | Real / derivable / partial | Paid = G18; "Clock synced" only for hotels connected to Clock, hidden otherwise |
| Edit reservation | **Gap** | See Page 4 (G23) |
| Cancellation review | Partial | Staff cancel and refund policy exist; the design implies a review step that shows the refund amount before confirming. Whether a preview endpoint exists is unverified (G26) |
| Four summary cards: Stay, Accommodation, Guests, Total & payment | Real | Check-in time "15:00" is not stored per booking (see D14) |
| Reservation and stay panel: source, mode, check-in/out with time, room type, assigned unit, occupancy, rate plan, cancellation policy text, internal status | Real except source and mode | Source G17; mode "Instant" relates to G19; the booking row already stores the free-cancellation window |
| Move room | Gap | Room assignment change; belongs with the front-desk work in Milestone 25 (G23) |
| Provider review | Partial | Manual-review items and Clock sync states exist; the per-booking entry point needs wiring |
| Payment and provider panel: payment status, PokPay transaction id, amount received | Real / derivable | Payment records and provider sessions exist; confirm the transaction id is exposed per booking |
| Clock PMS block: synced state, Clock reservation id, last confirmation time | Real / partial | External booking id is stored; "last confirmation" needs a defined source; hide for non-Clock hotels |
| Latest activity (3 events) | Derivable | Audit log and provider events exist; no per-booking activity endpoint (G24) |
| Open payment, Open guest | Real | Payment detail and guest detail screens exist |

Design notes for the build: the "Open payment" and "Open guest" buttons overlap in the Figma frame; fix when building. The header still shows demo wording ("WordPress Admin") that must come from the real user and role. This page becomes **one hotel only** (D5).

## Page 4 — Edit reservation

**Design source:** Figma PNG "Edit reservation". **Current state: almost none of this can be done today.** The booking update contract accepts only the **total amount**; the code states that room, rate, stay and guest changes are not available (`local-pms.provider.ts`). The roadmap already records that staff date changes are a future capability and that cancel-and-rebook is not the intended replacement. The Clock adapter has a dates-only update path, but nothing exposes it to staff.

| Design element | Class | Notes |
| --- | --- | --- |
| Stay dates, Room type, Rate plan, Adults, Children | **Gap** | Needs a staff booking-modification feature with live availability and price revalidation, a payment adjustment path (more nights = balance due, fewer = refund) and, for Clock hotels, an update sent to Clock (G23) |
| Child age | Gap | G12 |
| Assigned room | Gap | Belongs with room assignment in Milestone 25 |
| Check-in time, Check-out time per booking | Gap | Today there is no per-booking time; see D14 |
| Property (read only) | Real | Removed per D5 (one hotel at a time) |
| Guest: full name, email, phone | Gap for editing a booking's guest | Guest fields exist; editing them from a reservation is not exposed. Splitting "Full name" into first and last name matches the data |
| Guest: country, preferred language | Gap | Country G12; preferred language is not stored (G25) |
| Pricing: booking source, booking mode, currency, cancellation policy | **Should not be editable** | They are facts or agreed terms recorded when the booking was made. Industry practice keeps them read-only |
| Pricing: reservation total | Supported today, but risky | Total editing exists in the API. Best practice: totals come from rates; a manual change is a separate permissioned, reasoned, audited "Adjust price" action, not a normal form field |
| Deposit paid, Remaining balance | Derivable, read only | From paid amount, refunds and total |
| Internal notes | Gap | No staff-notes field exists (only the guest's special requests) (G25) |
| Change summary card (availability, price impact, provider sync, audit) | Gap | Needs a preview call that checks availability, recalculates price and reports payment and provider impact before saving |
| Payment & provider safety card | Real | Read-only payment facts plus a pointer to the payment workflow |
| Audit context (created by, updated by, times) | Partial | Timestamps exist; actor and source of each change come from the audit log (G24) |
| Save changes, Discard changes | Gap | G23 |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S11 | Keep the Edit page, but make **Pricing & booking settings read-only** and add a separate "Adjust price" action (permission, reason, audit entry) | Prevents silent changes to a paid reservation; the design itself says financial fields must not silently alter a completed payment |
| S12 | Show a **before / after comparison** in the Change summary and block saving until availability and price are revalidated | Staff see exactly what a change does to dates, price and payment |
| S13 | When a change alters the total, **force a payment decision** before saving: collect the difference (send a payment link or record it) or refund the difference | Avoids reservations that are silently out of balance |
| S14 | Make **Move room** a quick action with its own small dialog (room list that only shows free rooms for the stay) instead of a field inside the big form | The most frequent change at the front desk; belongs to the Milestone 25 room board |
| S15 | Offer **Resend confirmation** after any guest-visible change | Guests must receive the updated details |

**Decisions needed**

| # | Question |
| --- | --- |
| D13 | **Not answered by the owner; carried as proposed.** Edit pricing fields read-only with a separate Adjust price action, before/after comparison, forced payment decision on total change, Move room as a quick action, Resend confirmation (S11-S15). Page 8 (Amend) later re-decided how stay changes work (D22) |
| D14 | **Not answered; carried as proposed.** Check-in and check-out times default from the property (the property already stores them) with an optional per-booking override for early or late arrival; the override is the guest-request feature (D7, D108) |
| D15 | **Not answered; carried as proposed.** A booking with a payment pending may only have changes that do not alter the price; price-changing amendments follow the draft-until-paid rule (S26) |

## Page 5 — Add reservation, step 2: Guest information

**Design source:** Figma PNG (Step 2 of 3 in a stepper: Stay details, Guest information, Payment & review). **Current implementation:** `WalkInBooking`, a single form with guest name, email and phone. This design and the 4-step Quick booking tab from `/design/overview` describe the same job (staff creating a reservation). See D16.

| Design element | Class | Notes |
| --- | --- | --- |
| Breadcrumb, "Step 2 of 3", stepper | Real (UI) | New stepper component (C17) |
| Guest lookup (Existing / New tabs, search by name, email or phone, result card with "3 previous stays", Use this guest) | Real / derivable | Guest search exists on the Guests screen; "previous stays" count is a derivable number; matching on create already exists (guest-matching) |
| Lead guest: first name, last name, email, country code + phone | Real | Stored today |
| Lead guest: Guest type | Unclear | A lead guest is always an adult; drop unless a real use is defined |
| Lead guest: Nationality, Preferred language, Country of residence | **Gap** | Not stored (G12, G25). D8 already makes country optional; nationality and language are new |
| "Guest profile matched. Changes update this reservation only" | Derivable | Needs a rule for editing a matched profile vs the booking's own copy (see S16) |
| Additional guests (name, adult/child, relationship, parent/guardian, "use lead guest contact details", "Add another guest", child age) | **Gap** | Not stored (G12). Names optional per D8; child age required per D8 |
| Stay preferences: estimated arrival, bed preference, accessibility | **Gap** | Special requests exist; the three structured fields do not (G31). ETA was already suggested in D8 |
| Special requests | Real | Stored |
| Internal note (staff only, never in emails) | **Gap** | G25 |
| Stay summary card (Edit stay), estimated total | Real | From the quote |
| Guest validation card (lead guest complete, contact method, additional guests 0 of 2 named, duplicate check) | Derivable | Duplicate check = existing guest matching |
| Communication preview (recipient, language, channel; sent only after creation) | Real / derivable | Confirmation emails exist (Milestone 22); language needs G25 |
| Footer: Back to stay, Cancel, Continue to payment & review | Real (UI) | |

## Page 6 — Add reservation, step 3: Payment & review

**Design source:** Figma PNG (Step 3 of 3). **What exists today:** the walk-in flow takes payment through the payment provider's pop-up while the guest is with staff, or records "pay at hotel" and manual payments. Payment methods in the system: Stripe checkout, PokPay, pay at hotel, free. There is **no way for staff to email a payment link to a guest**, no coupons, no invoices, no billing details on a booking.

| Design element | Class | Notes |
| --- | --- | --- |
| Payment collection: PokPay connected badge, "full payment required" | Real | Connection state and rate-plan prepayment rule exist |
| Collection method: **Send secure payment link** | **Gap** | Staff-initiated emailed payment link (G27). The booking must stay unconfirmed until the provider's paid webhook, which is how guest payments already behave |
| Collection method: **Open PokPay checkout now** | Real | The existing pop-up flow |
| Recipient email, language, currency, "send a copy to the desk" | Real / partial | Language is G25; copy-to-desk is a small email option |
| Amount to collect: room x nights, taxes and fees, discount, total | Real / partial | The quote returns the total; a breakdown of taxes and fees must be checked against what the quote exposes |
| Apply coupon | **Gap** | No coupon feature exists (G28) |
| Add manual adjustment (finance permission, audit reason) | **Gap** | A total can be changed after creation; no adjustment before creation (G29). Matches suggestion S11 |
| Billing & invoice details (lead guest or company, tax id, "invoice generated only after payment") | **Gap** | No invoices or billing data until Milestone 25 (G10). Company and billing address are optional per D8 |
| Final reservation review: stay summary, guest summary, Edit links, policy note | Real | Pure summary of earlier steps |
| Final readiness check (stay, guest, live availability, final price, payment provider, email recipient, duplicate guest) | Derivable | Availability and price revalidation exist; provider connection and email checks are simple; duplicate = guest matching |
| Payment summary card: amount due, provider, collection, recipient, state after action ("Pending payment") | Real | |
| What happens next (revalidate, temporary inventory lock, create payment request, send link, after paid webhook: confirm, consume inventory, sync Clock, record folio, generate invoice, send confirmation) | Partial | Revalidate, hold (payment-pending status with expiry), idempotent payment request and confirmation email exist; "sync Clock" applies to Clock hotels only; "record folio" and "generate invoice" depend on Milestone 25. The list must adapt to the hotel |
| Failure protection card | Real behaviors | Idempotency and no confirmed booking before payment already exist; show as short help text, not a card |
| Confirmation controls: two required acknowledgements, "send confirmation", "generate invoice" | Mixed | See S18 |
| Footer: Back to guest, **Save draft**, Create & send payment link | Save draft: unchecked | A DRAFT booking status exists; whether a draft can be saved and resumed from the UI is unverified (G30) |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S16 | One booking-creation flow with three steps, entered from "Add reservation", the Overview quick-booking strip and the calendar. The 4-step Quick booking tab and this flow become the same thing | Two different flows for the same job confuse staff and double the work |
| S17 | **Offer only the payment options the hotel has configured**, in this order: Pay at hotel, Take payment now (card at the desk), Send payment link, Record manual payment (cash or bank transfer), No payment (complimentary). Each shows the state the booking will be in afterwards | PMS tools give staff all common ways to settle a stay; the design shows only one provider and one method |
| S18 | **Remove the two "I reviewed..." checkboxes.** Keep one optional toggle "Send confirmation email" (on by default). The review step itself is the confirmation | Forced acknowledgements slow every booking without preventing mistakes; the readiness check already blocks bad bookings |
| S19 | Collect **optional company and billing address** here now, even though invoices come with Milestone 25, and mark them as "used for invoices" | The data is useful later and costs nothing to capture at booking time |
| S20 | Show a **short, hotel-specific "what happens next"** (only steps that apply) instead of the fixed five-step list | Avoids promising Clock sync or invoices for hotels that do not have them |
| S21 | Make **Guest lookup the first thing on step 2**, defaulting to the lead guest search, and prefill everything from the matched profile (editable per booking) | Standard in PMS booking flows; avoids duplicate guest records |
| S22 | Keep the structured arrival, bed and accessibility choices as **request tags** stored on the booking and shown in the booking detail | Staff can scan them and housekeeping can use them later |

**Decisions needed**

| # | Question |
| --- | --- |
| D16 | **Decided: merge.** Add reservation and the Overview Quick booking tab become one 3-step flow (Stay details, Guest information, Payment & review) |
| D17 | **Decided: later, PokPay only.** "Send payment link" is built when its time comes and is simply the PokPay payment link (G27) |
| D18 | **Decided: yes.** S18-S22 accepted (no acknowledgement checkboxes, optional company/billing data, hotel-specific "what happens next", guest lookup first, request tags) |
| D19 | **Decided: out until planned.** Coupons stay out of the booking flow until a coupon feature is planned (G28) |
| D20 | **Resolved (owner, 2026-10-16): no Figma for step 1.** Step 1 (Stay details) is designed in-house from existing patterns (Page 5a) |

## Page 7 — Review cancellation request (cancellation approval)

**Design source:** Figma PNG "Review cancellation request" for MHB-1088. **What exists today:** staff can cancel a booking (`cancelBooking` in `LocalPmsProvider` applies the refund policy and, for Clock hotels, cancels in Clock); refunds can be amount- or percentage-based with a note. **There is no cancellation *request* and no approval step:** no pending state, no requester, reason category, priority, attachments, reviewer or decision record.

| Design element | Class | Notes |
| --- | --- | --- |
| Header badges incl. "Cancellation pending" | **Gap** | No "cancellation pending" booking status (G32) |
| Warning banner "affects payment, inventory and provider records" | Real (UI) | Standard confirmation notice |
| Cancellation request card (status, requested by, source "Guest phone call", reason category, guest requested refund, priority, requested at, attachments, detailed reason) | **Gap** | Request entity (G32); attachments need file storage (R2 is configured only on some hosts) |
| Reservation summary and Open reservation / payment / guest links | Real | |
| Cancellation policy evaluation (rate plan, policy snapshot "Version 3", free-cancellation deadline, request time, penalty, eligible outcome) | Partial | Booking rows store the free-cancellation window and cutoff; policy **versioning** is not stored (G33); the refund calculation exists inside cancel |
| Decision: cancel with full eligible refund / cancel without refund / cancel with custom refund (finance permission) | Partial | Refund by amount or percentage with a note exists; wiring the three choices and the finance permission is new (G34) |
| Refund table (paid, penalty, already refunded, refund to issue, method, state after approval "Refund pending") | Real / derivable | Payment records and refund state exist |
| Guest communication (template, language, two send toggles) | Partial | Cancellation emails exist (Milestone 22); a refund-confirmation email and language choice need checking (G25) |
| Internal approval note (required) | Gap | G25 / immutable decision record (G32) |
| Decision summary, pre-cancellation checks (9 checks), "What approval will do" (8 steps incl. credit note), failure handling, audit context | Partial | Most checks and steps map to existing cancel behavior; "create credit note or refund document" depends on Milestone 25 (G35); reviewer, permission key and immutable audit entries need the request model |
| Approve cancellation / Reject request | Gap | G32 |

## Page 8 — Amend reservation (stay change and room move)

**Design source:** Figma PNG "Amend reservation", two modes: **Amend stay** and **Room move**. This is the confirmed-reservation change flow, and it replaces the stay-changing parts of Page 4. **Current state: nothing here exists.** The API can only change a booking's total. (Gaps G23 and G36.)

| Design element | Class | Notes |
| --- | --- | --- |
| Mode switch: Amend stay / Room move | Gap | G23 / G37 |
| Amendment request (requested by, source, reason, guest approval received, requested operation, priority, details) | Gap | Needs an amendment record (G36) |
| Current reservation (read-only baseline) | Real | |
| Proposed changes: new check-in/out, new length, room type, room assignment, adults, children, child age, effective date, rate plan, pricing source, inventory source | Gap | Availability and quote engines exist and can be reused for revalidation; the modification feature is new (G23) |
| Room move planning (split stay with a target room and effective date) | Gap | Room assignment belongs with Milestone 25 front desk (G37) |
| Live availability and rate options (alternatives with price difference) | Partial | Availability and quote exist; "upgrade options" need a query over other room types |
| Original vs revised price table | Derivable | From the quote engine |
| Payment adjustment: send PokPay link, open checkout now, apply now and leave balance due (permission and audit) | Partial | Pop-up checkout exists; payment link is later (G27); "leave balance due" needs a permission and audit |
| Draft amendment with the current booking unchanged until paid | Gap | Core of the design; only needed when the price goes up |
| Change summary, final readiness checks (11 checks), what happens next (9 steps), provider impact, failure handling | Gap / partial | Clock hotels: the Clock adapter has a dates-only update path; other changes are new. Content must adapt to the hotel (S20) |
| Guest communication, internal amendment note, audit context | Partial | Emails exist; notes G25 |

## Page 9 — Resolve provider synchronization (manual review)

**Design source:** Figma PNG "Resolve provider synchronization" (an ambiguous Clock create-booking result). **What exists today:** manual review items with categories (unknown result, duplicate, missing mapping, simultaneous change, payment-booking mismatch, unknown status, schema mismatch) and two statuses, **Open and Resolved**. Resolution is a single "resolve" action in the **platform admin** area; there is no reviewer assignment, severity, evidence search, or choice of resolution. The code does a lookup-before-retry for unknown results.

| Design element | Class | Notes |
| --- | --- | --- |
| Header, "Provider result is unknown, do not retry blindly" banner, review summary | Partial | Category and message exist; severity, time in review, duplicate risk, reviewer do not (G38) |
| Review incident, reservation and payment snapshot, source-of-truth rules, provider operation card | Partial | Operation, idempotency key and correlation data exist in `integration_operations`; presentation is new |
| Reconciliation evidence: remote search, exact match / no match / conflict | Partial | The remote lookup exists in code; a staff-triggered "Run reconciliation check" and its result display are new (G38) |
| Reconciliation checklist, safe-action rules | Partial | Rules are design guidance; the checklist needs the evidence flow |
| Provider attempts timeline | Partial | Provider events and operations exist; no timeline view |
| Sanitized request and response viewer with redaction, diagnostic bundle download | Gap | Redacted viewer (G38); technical content, see S27 |
| Mapping and provider health card | Partial | Mapping tables and Clock health exist |
| Resolution decision: link existing / retry same operation / escalate / mark failed ("no force-synced") | **Gap** | Today a review can only be marked resolved |
| Reviewer note (required), immutable audit | Partial | Audit log exists; reviewer note on a review item is new |

## Page 10 — Reservations: empty, loading and error states

**Design source:** Figma PNG with three frames. These define the shared empty, loading and error treatment (component C14) for lists.

| State | Notes |
| --- | --- |
| **Empty** | "No reservations yet" with Add first reservation and Open provider settings, plus three "How reservations arrive" cards (staff booking, website booking, provider synchronization). Provider settings link exists; the cards are static help text and should adapt to the hotel (no "provider sync" card for a native-PMS hotel) |
| **Loading** | Skeleton table rows plus a banner "Loading reservations and checking data freshness". Freshness is derivable from the query's last-updated time (G39) |
| **Error** | "We couldn't load reservations" with a safe-failure message that creating, editing and exporting are temporarily blocked, Try again, last successful refresh time, and a chip naming the failed source. **"Open System Health"** points to the System health tab, which does not exist yet (G4); omit the link until it does |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S23 | **One "requests and approvals" model** shared by guest requests (Page 1c), cancellation requests (Page 7) and amendment requests (Page 8): request type, requester, reason, status, reviewer, decision note, audit | The three designs are the same workflow with different content; building it once saves two backends and gives staff one queue |
| S24 | **Cancellation: approve only the exceptions.** A staff member with the cancel permission cancels within policy directly (this page appears as a confirmation step with policy evaluation, the refund choice and the guest email). A request and manager approval is created only when the staff member lacks the permission, the cancellation is outside policy, or a custom refund is chosen | Two-person approval on every cancellation slows the front desk; it belongs on risky cases |
| S25 | Keep the design's **separate cancel decision and refund decision**, defaulting to the policy outcome, with the finance permission for custom amounts | It is exactly how finance wants it controlled |
| S26 | **Split editing into three actions:** Edit details (guest info, notes, preferences: immediate, no revalidation), Amend stay (dates, room type, occupancy, rate: revalidation and payment), Move room (room board, Milestone 25). Use the draft-until-paid pattern only when the price **increases**; apply equal or lower prices immediately and refund the difference | Matches how PMS tools treat risk, and keeps simple edits simple |
| S27 | **Provider review: hotel staff see a short "this booking needs review" card with Run check; the technical evidence, payload viewer and resolution actions live in the platform-admin area** (same reasoning as System health, D6) | Hotel staff should not handle idempotency keys, correlation ids or raw provider payloads, and only platform operators can resolve reviews today |
| S28 | **Adopt the Page 10 states as the standard** empty, loading and error panels for every list, with the empty-state help cards only where they add information | One consistent pattern |

**Decisions needed**

| # | Question |
| --- | --- |
| D21 | **Decided: yes.** Cancellations: staff cancel directly within policy; a request and manager approval only for exceptions (S24) |
| D22 | **Decided: yes.** Editing is split into Edit details / Amend stay / Move room (S26); Page 4 becomes "Edit details", Page 8 is the stay-change flow |
| D23 | **Decided: yes.** Provider review: simple card for hotel staff, technical evidence and resolve actions in platform admin (S27) |
| D24 | **Decided: yes.** One requests-and-approvals model (S23) and the standard empty/loading/error states (S28) |

## Page 5a — Add reservation, step 1: Stay details (designed in-house, no Figma)

**Source:** none supplied; the owner asked us to design it ourselves from existing patterns (D20). It is built from the "Stay & rooms" step of the Quick booking design in `/design/overview` and from the calendar prefill (Page 11). It is the first step of the merged flow (D16).

| Element | Class | Notes |
| --- | --- | --- |
| Stay dates (date range), nights count | Real | Existing availability search; date range picker is component C1 |
| Rooms count and per-room guests (adults, children, child ages) | Partial | Backend accepts several rooms; multi-room UI is G14; child ages G12 (required per D8) |
| Room type search results with price per night, rooms left, capacity | Real | Availability and quote exist |
| Rate plan choice per room type (for example flexible, non-refundable) | Real | A rate plan is chosen when a booking is created; the screen must list those available for the dates |
| Individual room choice ("auto-assign" or pick a room) | Partial | Only for hotels in individual-room or mixed mode; hidden in room-type-only mode |
| Booking summary card (dates, length, rooms, guests, estimated total, availability note) | Real | |
| Prefill from the calendar (dates, room) and the Overview strip | Real (UI) | Query parameters into step 1 |
| Footer: Cancel, Continue to guest information | Real (UI) | |

Layout follows the other two steps: stepper at the top, form on the left, summary on the right, sticky action bar at the bottom.

## Page 11 — Calendar

**Design source:** Figma PNG, three frames: default, filtered, and cell-details panel. **Current implementation:** `calendar.tsx` (938 lines): a **month grid of availability** per room (or per room type for room-type-only hotels), coloured Available / Limited / Sold out / Closed, month navigation, clicking a day lists that day's bookings, and a 3-step "Block availability" dialog (all, room types or rooms, date range) for owners and admins. It has **no reservation bars, no day-range choice, no search or filters, no summary figures, no side panel, no freshness indicator.**

| Design element | Class | Notes |
| --- | --- | --- |
| Title, breadcrumb, hotel select | Real | Hotel select replaced by the header switcher (D5) |
| "Clock PMS · Synced 2 min ago" chip | Derivable | Clock hotels only; native hotels show nothing or "Live" |
| Add reservation, Block availability | Real | Add reservation uses the merged flow (D16); blocks exist |
| Range controls: Today, previous/next, date range, 7 / 14 / 30 days | Gap (UI + data) | Today the grid is a calendar month; needs a server range query so only the visible window loads |
| "Room units" / room types switch | Real | Both row types exist (by mode) |
| Search guest or room | Real (client-side) | |
| Filters (room type, reservation status, payment) with count badge and removable chips | Real (client-side) | Same status and payment definitions as Reservations (G18) |
| Summary strip: occupancy, available tonight, arrivals, departures, require attention, provider issue | Derivable | From the Overview figures; "filtered occupancy" recomputed from the visible rows. "Provider issue" depends on G4 for non-Clock detail |
| Date header with "3 left" per day and a Today highlight | Real | Per-day availability counts exist |
| Group rows by room type with "3 / 5 available" | Real | |
| **Reservation bars** (guest, reference, status, payment, source label) spanning nights on a room row | **Gap** | Bookings, dates, status and assigned room exist; the grid and drawing are new (C26). Needs bookings fetched for the visible window, and bars only appear on a room row when a room is assigned |
| Room status chip per row (Ready, Arrival, Blocked, Review, Occupied, Issue) | Partial | Arrival, Occupied, Blocked and Review are derivable; **Ready and Issue need housekeeping / provider status**, which is the Milestone 25 room status board (G40) |
| Manual block bars ("Maintenance · Admin Staff"), Out of service ("Air conditioning repair") | Partial | Blocks exist as dates only; **no reason and no creator** (G41); out-of-service rooms belong to the Milestone 25 status board |
| "On request" bar (purple) | Gap | G19 |
| "Clock sync pending / provider issue" bar | Partial | Clock sync states exist per booking; hide for non-Clock hotels |
| Legend (Confirmed, Needs review, On request, Manual block, Provider issue) | Real (UI) | Same status map as Reservations |
| Footer: "Live revalidation" link | Derivable | Triggers a refetch |
| Cell details panel: summary (property, room type, unit, capacity, date, sellable inventory), availability message, **rates and restrictions** (starting rate, rate plan, minimum stay, stop-sell), **operational context** (previous departure, next arrival, housekeeping), Create reservation, Block availability | Partial | Rates, minimum stay and closed days exist as data; previous/next booking derivable; housekeeping is Milestone 25; the "open full availability management" link is dropped (D28) |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S29 | **Two views on one page:** Reservations (the designed bars) and Availability (today's colour grid), switched with a toggle | Room-type-only hotels and Clock hotels with no room assignment cannot show bars per room; the availability view is also what staff use to check selling inventory |
| S30 | **An "Unassigned" lane** at the top listing reservations that have no room yet | Standard in tape charts; lets staff see every reservation even before rooms are assigned |
| S31 | **Phase it:** first version read-only bars with click to open the reservation, and select-empty-cells to start Add reservation prefilled. Drag to move or extend a booking only after Amend stay and Move room exist (G23, G37) | Dragging is just a shortcut to those changes and must use the same revalidation and payment rules |
| S32 | Load only the **visible date range**, keep the first column and the header sticky, highlight today, support keyboard navigation | Performance and usability on 30-day grids |
| S33 | Use the **same status colours and payment definitions** as Reservations and the Overview | One meaning per colour across the app |
| S34 | Remember the user's last range, view and filters | Common expectation |

**Decisions needed**

| # | Question |
| --- | --- |
| D26 | **Decided: plan it.** Room status chips (Ready / Issue) and out-of-service rooms are planned with the Milestone 25 room status board (G40); until then the calendar omits them |
| D27 | **Decided: yes.** Blocks get a reason and a creator (G41) |
| D28 | **Decided: ignore.** No separate availability management page; the "Open full availability management" links are removed from the calendar design (G44 dropped) |

### Page 11 — Calendar: additional states and panels (second upload, 2026-10-16)

**11a. Block availability panel (slide-over).** Opens from the calendar ("Started from Calendar · Room 202"). Sections: selected scope (property, room type, room unit, scope), block period (starts, available again, blocked nights), block details (**reason**, **reference**, **title**, **internal note**), inventory impact ("1 room unit · 2 room nights removed from sale", "no reservation conflict or active hold detected", "existing reservations are never cancelled automatically"), provider synchronization (Clock connected, local validation passed, "pending provider confirmation after save"), Cancel and Create manual block.

| Element | Class | Notes |
| --- | --- | --- |
| Scope (all / room types / rooms) and date range | Real | The 3-step dialog already collects exactly this |
| Reason, reference, title, internal note | **Gap** | G41 (owner: yes) |
| Inventory impact and conflict detection | Derivable (unchecked) | Needs a check of overlapping reservations and active payment holds before saving; blocks never cancel reservations (matches the design) |
| Provider synchronization (Clock) | **Gap** | **No code sends a MUST-created block to Clock.** The system reads Clock stop-sales into the calendar but does not write blocks back (G45) |
| "Draft" badge, Created by | Gap | Blocks have no draft state or creator (G41) |

**11b. Reservation focus panel (slide-over).** Clicking a bar opens a summary: guest, reference, source, badges, a "Payment required" warning (amount due, "not confirmed or sent to Clock because payment is pending", inventory hold time left, payment link sent and expiry), stay, guest (returning guest, contact links), payment and operational state (total/paid, payment status, inventory hold, Clock status, invoice and email state), recent activity, and actions Edit reservation, Resend payment link, Open full reservation.

| Element | Class | Notes |
| --- | --- | --- |
| Stay, guest, total and paid | Real | |
| Inventory hold with time left | Derivable | Payment-pending bookings already expire; remaining time is computed from the expiry |
| Payment link sent, expiry, Resend payment link | Gap (later) | Staff-sent PokPay link is planned later (G27, D17) |
| Clock PMS "Not created" / invoice and email states | Partial | Derivable from booking status; invoice state depends on Milestone 25 |
| Returning guest | Derivable | Previous stays count |
| Recent activity | Gap | G24 |
| Actions | Real / partial | Edit reservation opens "Edit details" (D22); the panel is the same reservation preview used on the Reservations list (component C28) |

**11c. Setup state: "No room inventory mapped" (Clock hotels).** The calendar replaces itself with a checklist when Clock rooms are not mapped: Import room types from Clock PMS (Required), Map room units (Waiting), Verify availability (Waiting), with buttons Import rooms from Clock PMS and Map room units; Add reservation and Block availability are disabled. **Real:** the Clock catalog sync, mapping confirmation and an Integrations screen exist; the state is derivable from the mapping state (G47). Only owners and admins should see the action buttons (S37).

**11d. Loading state.** Skeleton grid, controls disabled, chip "Clock PMS · Loading calendar", message "Loading reservations, restrictions and availability from Clock PMS". Real UI pattern (S28, S39).

**11e. Stale / error state ("Calendar data could not be refreshed").** A banner says the board shows the last confirmed snapshot from a given time, new reservations and availability changes are paused, with Retry sync and Open provider diagnostics; the grid is labelled "Read-only snapshot"; the Clock chip reads "Sync failed · Last live 10:42". **Gap:** the product has no cached "last confirmed snapshot" of the calendar (G46); Clock circuit-breaker and health data exist. "Open provider diagnostics" points to technical content that belongs to platform admin (D23), so hotel staff get Retry sync only.

### Suggestions for the new states (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S35 | **Block form: required reason from a fixed list** (Maintenance, Renovation, Owner use, House use, Event, Other), optional internal note and optional reference (for example a work-order number). Drop the separate "Block title" (derive the bar label from the reason and note). **Hard-stop on conflicts:** if reservations overlap, list them and require moving or cancelling them first | Fewer fields to fill, consistent labels on the calendar, and no silent double-booking |
| S36 | **One reservation preview component** shared by the calendar, the Reservations list and search. Its actions depend on state (payment pending: resend link, release hold; confirmed: edit details, amend; in-house: later) | Same data, same actions, one thing to maintain |
| S37 | Show the setup checklist actions **only to owners and admins**; staff see "The calendar is not ready yet. Ask an administrator" | Staff cannot fix mapping and should not see provider controls |
| S38 | In the stale state keep **creating and editing disabled** (as designed) and always show the last-updated time, even when healthy | Prevents bookings from a possibly outdated board |
| S39 | Reserve the grid's size while loading so the layout does not jump | Basic polish |

**Decisions needed**

| # | Question |
| --- | --- |
| D25 | **Decided: accept (owner, 2026-10-16).** Calendar has two views (Reservations bars and Availability), an Unassigned lane, and drag-to-move only after the amend and move-room features exist (S29-S34) |
| D29 | **Decided: yes.** Block form per S35: fixed reason list, optional note and reference, no separate title, hard-stop with the list of overlapping reservations |
| D30 | **Decided: yes.** Blocks created in MUST for Clock hotels are also sent to Clock as a stop-sale (two-way sync, G45). Needs a Clock write path tested against the sandbox |
| D31 | **Decided: yes.** Shared reservation preview, setup actions visible to owners and admins only, stale-mode rules, fixed grid size while loading (S36-S39) |

## Page 12 — Accommodation (labelled "Hotels" in the design): Overview and Categories tabs

**Design source:** two Figma PNGs from the sidebar item "Hotels": a page with five tabs (Overview, Categories, Listings, Units, Import & Export). **Overview** and **Categories** were supplied; **Listings, Units and Import & Export have not been**. **What exists today:** two levels. **Room types** (name, description, maximum occupancy, main image, gallery, amenities intro) and **rooms** (name, floor, view, title, size, rules, description, belonging to a room type), managed in `room-management.tsx`, `photos-management.tsx` and `rate-management.tsx`. The design uses three levels: **Categories → Listings (room types) → Physical units (rooms)**. Milestone 13's kickoff notes already recorded this three-level hierarchy as a design/product gap.

| Design element | Class | Notes |
| --- | --- | --- |
| Tab bar, hotel chip, Add listing | Real | Add listing = create room type |
| Import Excel | **Gap** | No Excel or CSV import exists (G53) |
| Chips: "15 listings live", "39 active units", "6 setup issues" | Gap / derivable | "Live" needs a publish status (G48); "active units" needs a unit active flag (G50); setup issues are derivable from the readiness checks (G51) |
| Tile: Categories (4) | **Gap** | No category entity (G49) |
| Tile: Listings (18; "15 live, 2 draft, 1 hidden") | Real count, gap breakdown | Publish status G48 |
| Tile: Physical units (42; "39 active, 3 inactive") | Real count, gap breakdown | Rooms have no active/inactive flag (G50) |
| Tile: Booking readiness (83%, "15 of 18 listings fully bookable") | Derivable | From the readiness checks (G51) |
| Accommodation setup readiness list (7 checks with "n of 18 complete") | Derivable | Basic information, occupancy configuration, rate plan assigned, inventory source selected, physical units mapped, availability verified, storefront publishing: each check needs one written definition and a server-side calculation shared by every page (G51) |
| Needs attention cards (no active rate plan, units not mapped to Clock, storefront content incomplete, inventory source conflict) with fix links | Derivable | Mapping state, rate plans, photos and descriptions exist; **"inventory source conflict" is undefined** (G52) |
| Portfolio snapshot table (listing, category, units, source, availability, status, issues) | Partial | Source: see S44; category G49; status G48; availability derivable from the calendar |
| Inventory source card (Clock connected, last sync, listings mapped 15 of 18, units mapped 39 of 42, source conflicts, View connection, Resolve mapping) | Real / derivable | Clock catalog mappings (proposed / confirmed / rejected) and the Integrations screen exist; Clock hotels only, hidden for native hotels |
| Recent activity (published, linked to Clock, Excel import, occupancy changed, changed to Draft) | Partial | Audit log exists; publish and import events do not (G54, G24) |
| Quick actions: Add category, Add listing, Add physical unit, Import from Excel | Real / gap | Category G49, Excel G53 |

**Categories tab**

| Design element | Class | Notes |
| --- | --- | --- |
| Whole tab: category table (order, name, description, URL path such as /rooms/, listings, live listings, storefront Visible/Hidden, status, updated by and when), counts, search, status and storefront filters, Reorder categories, Category checks, Storefront order preview | **Gap** | No category exists in the data model, the public catalog or the WordPress plugin. Needs the entity, listing assignment, ordering, storefront visibility, the public catalog API and the WordPress booking pages to use it (G49) |
| "Storefront" and URL paths | Needs definition | "Storefront" means the hotel's public website (WordPress). URL paths must match how the plugin's managed pages are laid out; to be confirmed with the Managed Pages settings |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S40 | **Ship two levels first (Listings = room types, Units = rooms) and add Categories later as an optional grouping.** Most reservation systems model room type then room; a grouping above room types is a website-presentation feature that matters once a hotel has many room types | Categories need a new data model, a public API change and a WordPress plugin change; hotels with a handful of room types do not need them |
| S41 | **Name this section "Accommodations", and keep "Hotels" for the owner-only all-hotels view** (D5). The design calls the accommodation page "Hotels", which collides with the group view | One word, one meaning in the sidebar |
| S42 | **Define publish states precisely:** Draft = not bookable and not visible; Live = bookable and visible on the website; Hidden = bookable by staff but not shown on the website. A listing can only go Live when its required readiness checks pass | Today a room type is simply "there"; staff need a safe way to prepare one |
| S43 | **Compute readiness on the server once** and reuse it on the Overview, the listing page and the publish button | The Overview and the listing page must never disagree |
| S44 | **One inventory source per hotel, not per listing.** Show a listing that is not mapped to the PMS as an issue ("Not mapped"), not as a second source called "Local" | A hotel is either on Clock or on MUST (one active PMS per property); the design itself warns that local inventory must not compete with Clock |
| S45 | **Excel/CSV import with a template, a preview that shows errors row by row, then commit; plus export.** Later, as its own task | Standard for bulk setup of many rooms; needs its own validation work |
| S46 | **Units get an active/inactive state** now; out-of-service and housekeeping come with the Milestone 25 room status board | Keeps retired rooms out of availability without deleting them |

**Decisions needed**

| # | Question |
| --- | --- |
| D32 | **Decided: yes.** The section is named "Accommodations"; "Hotels" is reserved for the owner-only all-hotels view (S41) |
| D33 | **Decided (owner):** this register only notes features; the owner decides when each is built at the end. **But Categories are in the first release**: every room type belongs to a category (G49) |
| D34 | **Decided: yes.** Draft / Live / Hidden as defined in S42 (see D38 for how the design's two columns map to it) |
| D35 | **Decided (Claude's call, owner: "do what you think is best"):** one inventory source per hotel (S44). Listings inherit it; an unmapped listing is an issue, never a second source |
| D36 | **Decided: yes.** Excel/CSV import and export are planned for later (G53) |
| D37 | **Owner is sending the designs one by one.** Received so far: Overview, Categories, Listings. Still awaited: Units, Import & Export, Photos, Rates & Pricing, Inventory |

### Page 12b — Accommodation: Listings tab (design received 2026-10-16)

**Design source:** Figma PNG "Accommodation listings". A listing is a room type. The page text says "Listings inherit the hotel inventory source. Units and pricing are managed in their dedicated modules", which agrees with D35 (one source per hotel).

| Design element | Class | Notes |
| --- | --- | --- |
| Breadcrumb, hotel chip, Create listing | Real | Create listing = create room type |
| Chips (18 listings, 15 published, 14 booking ready, 3 need setup, "Clock PMS · Synced 4 min ago") | Derivable | Published needs G48; readiness G51; Clock chip for Clock hotels only |
| Four tiles (Total, Booking ready, Published, Needs setup) with links | Derivable | Same counts as the Overview tab |
| Filters: search (name, code or category), category, status, storefront, readiness, **modes**, sort | Real / partial | "All modes" is unclear: instant vs on-request booking (G19) is the only meaning that fits, so keep it hidden until that exists |
| Table: **listing name, code (for example DSV-01), URL slug** | Partial | Name is real. **Code and slug do not exist** (G55) |
| Table: category | Gap | G49 (first release) |
| Table: occupancy ("3 guests, King + sofa bed") | Partial | Maximum occupancy is stored; **bed configuration is not** (G56) |
| Table: units ("4 active, 4 mapped") | Partial | Unit count is real; active needs G50; mapped comes from Clock mappings |
| Table: booking readiness (Ready, Needs pricing, Pricing issue "conflicting pricing rules", Mapping required) with a one-line reason | Derivable | Rates and price rules exist; "needs pricing" and "conflicting rules" must be defined (G57) |
| Table: storefront (Published / Hidden / Not published) and lifecycle (Active / Draft) as two columns | Gap | Two columns, one real concept; see S47 |
| Table: updated by and time, row link, checkboxes, pagination (10 per page) | Partial | Updated-by is G54; pagination needs a list endpoint |
| Listing readiness checks (all have a category, names and slugs unique, need pricing, not mapped to Clock, no active units, public content complete) | Derivable | Same engine as G51; "slugs unique" needs G55 |
| Storefront coverage (published / hidden / draft counts, cover images 16/18, public descriptions 15/18, per-category progress bars) | Derivable | Cover image and description exist per room type; category bars need G49 |
| Actions: Review setup issues, Review storefront listings | Real (UI) | Filters |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S47 | **One status per listing with three values** (Draft, Live, Hidden, per S42), shown in one column. The design's two columns collapse like this: Draft + Not published = Draft; Active + Published = Live; Active + Hidden = Hidden | Two independent columns allow nonsense combinations (Draft but Published); one status cannot |
| S48 | **Store bed configuration as a structured list** (bed type and count, for example 1 king + 1 sofa bed) and show it as text; use it for display and to cross-check capacity | Standard in booking sites; free text goes stale |
| S49 | **Slug generated automatically from the name, editable, always unique; listing code optional and auto-suggested** | Staff should not have to invent identifiers |
| S50 | Every non-ready state names **one next action** ("Needs pricing: add a rate"), as the design already does | Keeps the table scannable |
| S51 | **Bulk actions** (assign category, publish, hide) on selected rows | Setting up many listings is the main use of this page |

**Decisions needed**

| # | Question |
| --- | --- |
| D38 | **Decided: ok.** A listing has one status (Draft / Live / Hidden) instead of the Lifecycle and Storefront columns (S47) |
| D39 | **Decided: yes.** Structured bed configuration; automatic unique slug; optional listing code (S48-S49) |
| D40 | **Decided: ok.** Bulk actions (assign category, publish, hide) are noted as a feature (G59); whether they ship in the first release is decided at the end |

### Page 12c — Create listing (design received 2026-10-16)

**Design source:** Figma PNG "Create listing" (a long single form). The listing is created as **Draft**, hidden until inventory, pricing and publishing checks pass; physical units, prices and availability blocks are explicitly done elsewhere ("configuration boundaries" card).

| Design element | Class | Notes |
| --- | --- | --- |
| Name (unique per hotel), Category (required) | Real / first release | Name exists; category G49 |
| Internal code, slug, public URL preview | Gap | G55 |
| Short description, internal description | Gap | Only one description exists today (G61) |
| Maximum guests, maximum adults, maximum children, size m2 | Partial | Maximum occupancy exists; separate adults/children limits and size at listing level are new (G62) |
| Bedrooms, bathrooms, view type, floor information | Partial | View type and floor exist on rooms, not on the listing (G62) |
| Bed configuration (bed type x count, add/remove) | Gap | G56 |
| Booking mode: Instant / On request | Partial | Instant is today's behavior; On request is planned (G19) |
| Inventory source "Clock PMS, inherited from hotel, Connected"; Clock room-type mapping select with Refresh options | Real (Clock hotels) | Clock catalog sync and confirmation exist; hidden for native hotels (D35) |
| Cover image upload, gallery (at least 3 images), drag to reorder | Partial | Main image, gallery and a property photo library exist (Milestone 23); drag reorder needs C29 |
| Public description (required before publishing) | Real | |
| Storefront label ("Popular") and initial storefront state | Gap | G63 / G48 |
| Amenities (checkbox list) | Real | Amenity library and room-type links exist |
| Guest and stay rules (smoking, pets, extra bed, cot, accessible, children accepted, minimum guest age) | Gap | G60 |
| Right column: listing summary, creation checks (required to create vs required to publish), storefront preview, next setup steps, configuration boundaries | Derivable | Same readiness engine (G51) |

### Page 12d — Listing detail / edit (design received 2026-10-16)

**Design source:** Figma PNG for "Deluxe Sea View": the same sections as Create plus operational panels.

| Design element | Class | Notes |
| --- | --- | --- |
| Header: breadcrumb, badges (Active, Published, Booking ready), Preview storefront, Save changes, "Last saved by X" | Partial | Updated-by is G54; preview opens the public page |
| Chips (listing id, 4 active units, 3 active rate plans, Clock sync, storefront state) | Derivable | |
| All form sections (basic, accommodation details, booking configuration, storefront presentation, guest and stay rules) | See Page 12c | Slug-change warning ("may affect existing storefront links") is a real concern for the WordPress site |
| Listing status card (lifecycle, storefront, readiness, mode, last updated, updated by), Hide from storefront | Gap | G48, G54 |
| Booking readiness (8 checks incl. provider room type mapped, units linked, base pricing, active rate plan, future availability verified, cover image, public description) | Derivable | G51 |
| Units and inventory card (active, Clock mapped, unmapped, availability source, next 90 days verified, last sync; Manage units, Open calendar) | Derivable | |
| Pricing and rate plans card (base pricing configured, active rate plans, rules, scheduled rules, pricing issues, currency; Configure pricing, View rate plans) | Partial | Rate plans and rules exist; "scheduled rules" and "issues" need definitions (G57) |
| Clock PMS connection card (provider room type id, physical units mapped, last sync, validation) | Real / derivable | Clock hotels only |
| Storefront preview card, Recent activity | Partial | G24 / G54 |
| Listing lifecycle: **Archive listing** (stops new bookings, keeps history) and **Delete permanently** (disabled when reservations, mappings, units or audit history exist) | Gap | No archive state (G64) |
| Sticky bar "Last saved ..., Discard changes, Save changes" | Real (UI) | C20 |

### Page 12e — Units list (design received 2026-10-16)

**Design source:** Figma PNG "Physical accommodation units". The page text states **"Clock PMS is the inventory source of truth. Create or remove physical rooms there, then synchronize them here."** while the header still shows both Sync from Clock PMS and Add unit.

| Design element | Class | Notes |
| --- | --- | --- |
| Sync from Clock PMS | Real (Clock hotels) | Catalog sync and confirm exist |
| Add unit | Real (native hotels only) | Contradicts the Clock text for Clock hotels (S52) |
| Chips and tiles (15 units, 14 active, 14 mapped, needs attention; Total, Provider mapped 14/15, Booking eligible 13, Needs attention 2) | Derivable | Active needs G50; eligible = active, mapped and not blocked |
| Filters: listing, status, mapping, state, floor, room number | Real / partial | Floor exists; status and state need G50 |
| Table: unit name and **code (RM-201)**, listing and category, **location (floor, wing)** | Partial | Name and floor exist; code and wing do not (G65) |
| Table: provider mapping (Clock id, Mapped / Not mapped, "provider unit required") | Real | Mapping rows exist |
| Table: operational state (Available for booking, Manually blocked "maintenance until 29 Jul", Provider unavailable) | Partial | Blocks exist; reason G41; "provider unavailable" derivable from missing mapping |
| Table: current context (Occupied today and checkout date, Available today, Blocked today, Not bookable) | Derivable | From bookings with an assigned room, or Clock stay data (G67) |
| Table: lifecycle (Active), last sync and source | Partial | G50; last sync from mapping timestamps |
| Unit configuration health checklist; Operational availability counts and per-listing eligibility bars; Open Calendar Board | Derivable | |

### Page 12f — Unit detail (design received 2026-10-16)

**Design source:** Figma PNG for "Room 201". It states it stores local operational metadata "without introducing housekeeping workflows".

| Design element | Class | Notes |
| --- | --- | --- |
| Unit identity: name, **code**, listing assignment, inherited listing summary, **internal alias** | Partial | Name and room type exist; code and alias G65 |
| Location: room number, floor, **wing/area, building, access notes, internal location notes** | Partial | Floor exists; the rest G65 |
| Clock PMS mapping (provider room, Clock id, provider room type, status, last verified; Change mapping, Refresh, View sync details; compatibility checks; "mapping blocks exact-unit availability until revalidated") | Real / derivable | Mapping rows with sync state exist; compatibility checks derivable |
| Operational configuration: lifecycle, booking eligibility, local operational state, current manual block, Create manual block, Open calendar, Review block history, exact-unit availability validation list | Partial | Blocks and history from the calendar (G41); **local operational state** overlaps the Milestone 25 room status board, which should be the single model (S61) |
| Unit presentation: inherit from listing or custom (public unit name, short description override, cover image override, customer-facing note) | Gap | Only relevant when guests can choose an exact room (S58) (G66) |
| Internal unit notes (staff notes, provider sync note) | Gap | G65 / G25 |
| Right column: unit status, current inventory context (today, current stay, checkout, next arrival, open checkout lock, manual block), inherited from listing, Clock connection, exact-unit booking integrity (7 checks), presentation preview, recent activity | Derivable / partial | Context from bookings and blocks; integrity checks are the same validations availability already performs; activity G24 |
| Unit lifecycle: Deactivate, Archive, Delete permanently (disabled with history) | Gap | G50, G64 |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S52 | **Show only the buttons that fit the hotel's source:** Clock hotels get Sync from Clock PMS and no Add unit; native hotels get Add unit and no sync. Units in a Clock hotel are created in Clock and appear here by synchronization | Two competing sources of truth is the problem the design itself warns about (S44) |
| S53 | **Create listing as a short form** (name, category, capacity, bed configuration, booking mode, Clock mapping for Clock hotels), then continue on the listing detail page where storefront text, photos, amenities and rules are completed with the readiness checklist guiding the way | Long creation forms get abandoned; the design's "next setup steps" card already works this way |
| S54 | **Three description fields:** short public description, full public description, internal description | Cards need short text, pages need long text, staff need private text |
| S55 | **Guest and stay rules stored on the listing as optional overrides** of a hotel-level default (empty = inherit) | Hotels set rules once and only override exceptions; the design says the same |
| S56 | **Slug changes warn and redirect**: when a live listing's slug changes, keep the old path redirecting to the new one | Avoids breaking the WordPress site and search results |
| S57 | **Gallery from the property photo library with drag reorder; the first image is the cover** | Reuses Milestone 23's library; fewer duplicate uploads |
| S58 | **Unit presentation overrides only appear for hotels that let guests choose an exact room** (individual-room or mixed modes) | In room-type-only hotels guests never see a unit |
| S59 | **Archive instead of delete when history exists; delete only when nothing references the record** | Standard data hygiene for bookings and audit |
| S60 | **Unit and listing detail pages share one layout** (summary on the right, sections on the left, sticky save bar) | One pattern to learn and maintain |
| S61 | **One room status model.** The unit page shows operational state read-only until the Milestone 25 room status board owns it | Avoids two competing "state" fields |

**Decisions needed**

| # | Question |
| --- | --- |
| D41 | **Decided: yes.** Create listing is a short form first; the rest is completed on the listing detail page (S53) |
| D42 | **Decided: yes.** Clock hotels get "Sync from Clock PMS" and no "Add unit"; native hotels get "Add unit" and no sync (S52) |
| D43 | **Decided: yes.** Unit-level custom presentation (own name, photo, note) appears only in hotels where guests can pick an exact room; hidden otherwise. Exact-room selection already exists (Milestone 10) |
| D44 | **Decided: combination (owner).** House rules are set **once for the hotel** and apply to every room by default; a **room type (listing)** can override a rule, and a **specific room (unit)** can override again. Three levels: hotel, listing, unit (G60) |
| D45 | **Decided: yes.** Three description fields, slug redirects, photo-library gallery with reorder, archive instead of delete, one room status model (S54, S56, S57, S59, S61) |

### Page 12g — Accommodation: Import & Export tab (design received 2026-10-16)

**Design source:** Figma PNG "Excel import and export". **Nothing exists today** (no spreadsheet library, no import jobs, no templates). The design: a versioned workbook (template 1.2) with sheets Instructions, Categories, Listings, Units and Reference Values; import scopes (full workbook, categories only, listings only, units only); behavior "create new and update existing" matched on stable codes (`category_code`, `listing_code`, `unit_code` plus `provider_unit_id`); a 3-step flow (Prepare workbook, Upload and validate, Review and apply); pre-validation checks (file format, required sheets and columns, size under 10 MB, template version, hotel match); safeguards (every row validated, blocking errors stop the whole import, warnings need confirmation, no changes until confirmed, existing reservations never modified, imports **never delete**); an export section (full workbook, categories, listings, units, provider mapping report; options for inactive, archived, internal notes, public content, Clock provider IDs, lifecycle states); recent import and export activity with results and error links.

| Design element | Class | Notes |
| --- | --- | --- |
| Download master and per-sheet templates (versioned) | Gap | G53 |
| Upload, pre-validation checks, validate (dry run), review results, apply | Gap | A validation engine and an apply step in one transaction (G53) |
| Stable codes for categories, listings, units | Gap | Depend on G49, G55, G65 |
| "Imports cannot permanently delete records; archive stays an explicit action" | Real (rule) | Matches S59 |
| "Clock remains authoritative for physical rooms and provider inventory" | Rule | See S63 |
| Export with scope and options | Gap | Straightforward once the data fields exist |
| Recent import and export activity (file, type, scope, rows, result, who, when, view errors, download, generate again) | Gap | Needs a jobs table and stored files (G69) |
| "Managed outside Excel import": images, pricing, rate plans, availability, reservations, manual blocks, payments, Clock room creation | Rule | Keeps the workbook small and safe |

### Page 12h — Accommodation: Setup warnings (design received 2026-10-16)

**Design source:** Figma PNG "Accommodation setup warnings", reached from the Overview. It lists every configuration issue that affects booking readiness, provider synchronization or storefront completeness.

| Design element | Class | Notes |
| --- | --- | --- |
| Header, Export warning report, Run setup checks | Derivable | Recompute the readiness engine (G51); export is a CSV/Excel of the list |
| Tiles: blocking issues, configuration warnings, affected records, setup coverage "31 / 37 ready" | Derivable | |
| "Setup warnings are derived automatically; assignment or acknowledgement does not resolve the cause" | Rule | A good principle, keep it |
| Filters: all / blocking / warnings / information / in progress / resolved; severity, area, record type, status; search | Derivable / partial | "In progress" and "Resolved" need issue state (G70) |
| Issue list: severity, issue, record, area (provider mapping, inventory, pricing, storefront, relationships), effect, assignee, status, "Why this matters", rule code (BOOKING_READY_REQUIRES_PROVIDER_UNIT), recommended steps, action link | Derivable / partial | Issues and fix links derivable; assignee and status G70; stable rule codes G71 |
| Accommodation readiness bar, Issues by area bars, Automatic checks panel (per check count and result) | Derivable | |
| Resolution ownership (assign unresolved issues, waiting for recheck) | Gap | G70 |
| Recently resolved | Gap | Needs a history of issue state (G71) |

### Page 12i — Accommodation: empty and error states (design received 2026-10-16)

| State | Notes |
| --- | --- |
| **Empty** ("No accommodations have been configured") | Actions: Import rooms from Clock PMS (Clock hotels), Create first category, Import from Excel; recommended setup path in three steps; readiness 0%. Real: Clock import and category/listing creation; the content must adapt to the hotel's source (D35). Not all buttons apply to native hotels |
| **Error** ("We couldn't load accommodation data") | Last known state, recovery actions, data-safety notes (no records changed), write actions disabled until the load succeeds. Follows S28 and S38; "Open system health" is dropped (D23) and "Contact technical support" needs a defined support contact |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S62 | **Build Export first, then Import.** Export is read-only and safe and also produces the exact template; import follows with the dry-run, review and apply flow in the design | Lets staff back up and review data early; import is the risky half |
| S63 | **Clock hotels: Units sheet is export-only plus mapping updates.** Units are created in Clock and arrive by synchronization (S52). Native hotels can create and update units by Excel | Prevents Excel from creating local rooms that compete with Clock |
| S64 | **Use a maintained spreadsheet library (for example ExcelJS) and check its licence and size before adopting it**; do not write a custom parser. Support CSV as well as .xlsx | Spreadsheet parsing is easy to get subtly wrong |
| S65 | **Setup warnings: derive automatically, no assignment or in-progress state in the first release.** Add owner assignment later if hotels with large teams ask | Small hotels rarely assign setup issues; the derived list already tells them what to fix |
| S66 | **Store each import as a job** (file, scope, rows, result, errors, who, when) and keep error reports downloadable | Needed for the activity list and for support |

**Decisions needed**

| # | Question |
| --- | --- |
| D46 | **Decided: yes.** Import & Export: build Export first, then Import; Clock hotels' Units sheet is export-only plus mapping updates; use a maintained spreadsheet library after checking licence and size (S62-S64) |
| D47 | **Decided: yes.** Setup warnings are derived automatically with no assignment workflow at first; imports are stored as jobs (S65-S66) |

## Page 13 — Rates & Pricing

**Design source:** five Figma PNGs from one section with six tabs (Overview, Base prices, Pricing rules, Rate plans, Taxes & fees, Issues): **Pricing overview, Base prices, Pricing rules list, Create pricing rule, Edit pricing rule.** The **Rate plans, Taxes & fees and Issues tabs have not been supplied.** In the design's sidebar this section is highlighted as "Inventory" while the page title says "Rates & Pricing"; the real sidebar has both a Rates & Pricing and an Inventory item (see D48).

**What exists today** (`rate-management.tsx`, 947 lines; tables `rate_plans`, `rate_rules`, `room_price_overrides`, `cancellation_policies`): every rate plan has **its own absolute nightly price per room type**, optionally for a date range and weekdays (a rule with no dates is the all-year base), plus optional per-room price overrides. For Clock hotels the real prices come from Clock; MUST can only set a priority between Clock rates. A booking stores its nightly rates and total. **There are no percentage or fixed adjustments, no rule priority, no derived rate plans, no occupancy supplements, no taxes or mandatory fees, no booking-window or stay conditions, and no rule versions.**

**The design's price model:** base price per room type per date (entered tax-exclusive) → pricing rules (percentage or fixed, priority-ordered) → rate-plan adjustment (derived plans such as "Non-refundable −10%" and "Breakfast Included +€18 per guest per night") → occupancy supplements → taxes and mandatory fees → customer total, stored as a complete, immutable pricing snapshot on the booking.

### 13a — Pricing overview

| Design element | Class | Notes |
| --- | --- | --- |
| Chips and tiles: room types priced, price coverage 98% over the next 90 days ("412 / 420 room-type dates"), base prices 5 / 5, active rate plans, pricing issues | Derivable | Coverage = dates with a usable price; issues need written definitions (G78) |
| Upcoming pricing coverage table (base, min, max after rules and rate-plan adjustments, coverage bar, issues) | Partial | Base and coverage derivable now; min and max need the new pricing engine (G73) |
| Active pricing rules list; Rate plans list with "Base / Derived % / Derived Fixed" | **Gap** | Adjustment rules and derived plans do not exist (G73) |
| Pricing needs attention (missing prices, same-priority conflict, rate plan not assigned, tax effective date missing) | Partial | Missing prices derivable; the rest depend on G73, G74 |
| Configuration health (currency, entry tax-exclusive, customer display tax-inclusive, default rate plan, base prices, taxes/fees 2 of 3, pricing source, inventory source, last validation) | Partial | Taxes and display setting G74; pricing source see D49 |
| Recent pricing activity | Partial | Audit log; G24 |
| Quick actions; export pricing matrix | Real / derivable | |
| "How the final price is calculated" card | Rule | Explains the model above |

### 13b — Base prices

| Design element | Class | Notes |
| --- | --- | --- |
| Base price calendar: room types x dates, 7 / 14 / 30 days, cells marked Base, Manual or Missing price, inline edit | Partial | The same data exists as all-year and date-range rules; a spreadsheet-style editor is new (G77, component C33) |
| Bulk price update: dates, room types, rate plan, days of week, operation (set fixed price), amount, reason, preview ("14 nightly prices will change"), Review & apply | Partial | Creating many rules exists; preview, reason and one-step bulk are new (G77) |
| Missing base price list; "dates without a price are excluded from public availability" | Derivable | Safeguard rule; check what the public calendar does today for unpriced dates |
| Import / Export | Gap | Part of G53 |
| Recent base price changes; "booking prices remain immutable after confirmation" | Partial / real | Bookings already store nightly rates and totals |

### 13c — Pricing rules list

| Design element | Class | Notes |
| --- | --- | --- |
| Rules table (name, adjustment, scope, effective period, priority, status Active / Scheduled / Active with warning), filters, search, sort | **Gap** | New rule model (G73) |
| Overlap warning ("1 overlapping rule needs review") and "equal-priority overlaps are blocked" | Gap | Needs the overlap check and a defined evaluation semantics (D51) |
| Evaluation order card, deterministic pricing note, recent rule activity, archived rules | Gap | G73 |

### 13d — Create and edit pricing rule

Five-step form (Details, Adjustment, Scope, Schedule & priority, Review) with a live rule summary, estimated impact, a validation checklist and, when editing, a change note, rule history and audit (rule id, published version, last validated) and Archive rule.

| Design element | Class | Notes |
| --- | --- | --- |
| Name, status (Draft / Active), internal description | Gap | G73 |
| Adjustment: percentage or fixed amount, increase or decrease, amount, rounding | Gap | G73 |
| Scope: room types, rate plans, stay conditions (occupancy, minimum stay) | Gap | Minimum stay exists as data from Clock, not as a pricing condition |
| Schedule: start and end date, days of week, priority, booking window (lead time), time zone | Gap | Time zone: see G72 |
| Estimated impact ("€21,480 additional room revenue if current availability sells") and change impact vs the active version | Gap | Speculative figure; see S71 |
| Validation checklist (required fields, base prices available, scope sellable, equal-priority conflicts, lower-priority overlap) | Gap | |
| Versioning ("published version v8"), archive instead of delete, mandatory change note for active rules | Gap | G73 |
| "Confirmed bookings never change" | Real | Bookings store their own prices |

### Finding while preparing this plan (2026-10-16)

The Node runtime used locally (v24.15.0, ICU 78.2, time zone data 2026a) **rejects `Europe/Tirana` as a time zone**, while `Europe/Belgrade` and `Europe/Rome` are accepted. Signup validates the property time zone with this runtime and falls back to UTC when none is given. Rules, check-in times and "today" for an Albanian hotel all depend on the property time zone. **Not verified on the production host**, which may run different runtime data. Needs checking before time-zone-dependent pricing (G72).

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S67 | **One pricing source per hotel, like inventory (D35).** Clock hotels: prices come from Clock and this section shows them read-only (with MUST's priority setting); native hotels: MUST's pricing engine. The design shows "Pricing source: MUST local" next to "Inventory source: Clock PMS", which would make MUST quote one price while Clock books another | A booking created in Clock uses Clock's price; quoting a different one produces mismatches |
| S68 | **Add derived rate plans on top of today's independent plans** (percentage or fixed per guest per night) instead of replacing them; existing plans keep working | Fewer prices to maintain and no migration risk |
| S69 | **When rules overlap, the highest-priority matching rule applies and the others do not (no stacking), unless a rule is explicitly marked stackable later.** The design's overlap warnings only make sense under this reading | Predictable prices; stacking percentages is a common source of surprises |
| S70 | **Provide a "price explainer":** pick a room type, date and rate plan and see the price built line by line (base, rule, plan, supplement, tax, total) | Standard support tool; answers "why this price?" without engineering help |
| S71 | **Leave out the "estimated additional revenue" figure in the first release** | It assumes all free nights sell, which is misleading; add later as a clearly labelled scenario if wanted |
| S72 | **Validate the whole booking horizon (how far ahead the hotel sells), not only 90 days** | Coverage gaps beyond 90 days still lose bookings |

**Decisions needed**

| # | Question |
| --- | --- |
| D48 | **Decided: its own item.** "Rates & Pricing" is its own sidebar entry, separate from "Inventory" |
| D49 | **Decided: yes.** One pricing source per hotel; Clock hotels show Clock prices read-only (S67) |
| D50 | **Decided: yes.** Derived rate plans are added next to today's independent plans (S68) |
| D51 | **Decided: yes.** When pricing rules overlap, the highest-priority rule applies and the others do not (no stacking) (S69) |
| D52 | **Decided: yes.** Price explainer, no revenue estimate at first, validate the full booking horizon (S70-S72) |
| D53 | **Resolved:** Rate plans, Taxes & fees, Issues and the states sheet received; Photos has no page (D61) |

### Page 13e — Rate plans list (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Plan table: name and description, pricing ("Base", "-10% after pricing rules", "+€18 adult per night", "-8% for 14+ days before arrival"), inclusions and terms (meal plan, payment, cancellation), scope and channels, code (FLEX, NRF, BB, ADV14), status (Active / Draft with warning) | Partial | Plan name, active flag and cancellation terms exist; **code, derived pricing, meal plan, scope, channels, advance-purchase window are new** (G80) |
| Filters: search, status, meal plan, channels | Partial | Channel filter see S74 |
| Banner "1 rate plan cannot be published (not mapped to a room type)" | Derivable | Scope completeness check |
| Fallback plan ("Standard Flexible is the fallback") | Gap | Property default offer (G80, S76) |
| Recent rate plan activity, "Rate-plan composition" card, View archived plans, Validate plans, Create rate plan | Partial | G24; archive G64 |
| Header chips ("Source · MUST local") | Rule | Clock hotels: read-only (D49) |

### Page 13f — Rate plan detail / edit (design received 2026-10-16)

Five-step form (Identity, Pricing, Terms, Scope & channels, Review) with plan summary, customer price preview, publish readiness and plan history.

| Design element | Class | Notes |
| --- | --- | --- |
| Identity: name, status (Active, Draft, Archived), plan code (immutable) | Partial | G80 |
| Pricing basis: **Derived or Independent**, base source (base prices + pricing rules), plan adjustment, rounding | Gap | D50 accepted; derived plans are new (G73, G80) |
| Inclusions and terms: meal plan (Room only, ...), payment terms (full online payment), cancellation policy ("Flexible, free until 3 days before arrival") | Partial | Cancellation policies exist; meal plan new; payment terms per plan to confirm (D57) |
| Scope and distribution: room types (all or subset), publication period, **channels** (Web, Staff, Clock, Booking, Airbnb, Expedia, Other), fallback role, booking window, source of truth | Partial | Room types and public vs staff are natural; **external channels do not exist** and the design itself warns they stay disabled (S74) |
| Booking restrictions (minimum and maximum stay, occupancy, closed to arrival / departure) | Partial | Minimum stay exists as data from Clock; the rest new (G80) |
| Customer price preview, publish readiness, plan history and audit (plan id RP-0001, published version v12), Archive, Duplicate | Gap | Versioning G73; archive G64 |

### Page 13g — Taxes & fees (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Items table: name, amount (6%, €2.00, 3%, €25), calculation basis (accommodation subtotal after rules and plan, per adult per night, booking subtotal before taxes, once per reservation), applies to (room types, plans, channels), display (**Included** in room price or **Added**), status | **Gap** | No tax or fee model exists (G74); example items (Accommodation VAT 6%, City tax, Service fee, Cleaning fee) are demo values |
| Banner "1 mandatory fee cannot be published" (scope incomplete), draft items excluded from totals | Derivable | |
| Customer total composition card and **"Fiscal configuration safeguard: rates and statutory applicability must be confirmed per property"** | Rule | Agrees with the open legal question of Milestone 25: nothing here may ship with pre-filled rates (S77) |

### Page 13h — Pricing issues (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Issue table: area (missing base prices, source-of-truth conflict, rate-plan mapping, fee scope, rule overlap, external provider mappings), severity (Blocking, Warning), issue, affected scope, impact (checkout blocked, sync paused, publish blocked, fee excluded), state (Open, Monitoring, Deferred), issue code, action | Derivable | Same engine as the Accommodation setup warnings (S78) |
| "Hotel 2 Sejour" in a source-of-truth issue | Remove | One hotel at a time (D5); under one-source-per-hotel (D35) a conflict can only be a misconfiguration |
| "External provider mappings: Clock, Booking and Airbnb are unmapped" | Remove for now | No channel manager (S74) |
| "Assigned to Mira Kola" in activity | Defer | No assignment workflow at first (D47) |
| Resolution priority and "fail-safe pricing behavior" (blocking configurations are excluded from checkout or sync; confirmed bookings keep their snapshots) | Rule | Good principle: limit blocking to the affected dates, plans or room types |

### Page 13i — Pricing states reference sheet (design received 2026-10-16)

A documentation-style page of seven states: first-time setup (minimum sequence: base prices, rate plan, taxes & fees, validation), no results for filters, validation could not complete (draft preserved, retry validation), external pricing source unavailable (partial data; "never silently switch the authoritative source"), read-only for this role (with **Request access**), taking longer than expected, and could not be loaded (with a **reference code** such as PRC-LOAD-500), plus a state behavior matrix and recovery principles. This is the section's use of the standard empty, loading and error panels (S28, D24). Items to note: **"Request access" has no workflow behind it** (S79), **reference codes** need a request id surfaced to the user (G84), and **"Open diagnostics"** is technical content for the platform area (D23).

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S73 | **Rate plan lifecycle Draft, Active, Archived, with an immutable plan code once any booking uses it, and a published version history** | Bookings and integrations refer to the code |
| S74 | **Channels: show only Website and Staff for now.** Hide Clock, Booking, Airbnb, Expedia and Other until a channel manager exists | Matches D12 (OTA later); avoids dead options |
| S75 | **Meal plan as a structured field** (Room only, Breakfast, Half board, Full board); a priced supplement is a derived plan with a per-guest-per-night adjustment | Guests compare plans by meal inclusion |
| S76 | **Exactly one Active fallback plan per property**; it cannot be archived until another plan takes the role | The booking flow always needs a default offer |
| S77 | **Taxes and fees: calculation bases (percentage of accommodation subtotal, per person per night, per stay, percentage of booking subtotal), display (included or added), effective dates, scope by room type and plan, versioned. Ship with no pre-filled rates;** the owner or accountant confirms local rates | Tax rules differ per country and must not be assumed |
| S78 | **One issues engine for both Accommodation setup warnings and Pricing issues** (areas: accommodation, pricing, provider) with stable rule codes | Two engines would drift |
| S79 | **"Request access" becomes a plain message naming who can change pricing (the owner or an admin);** no access-request workflow in the first release | Smallest thing that explains the lock |

**Decisions needed**

| # | Question |
| --- | --- |
| D54 | **Decided: yes.** Rate plan lifecycle and immutable code, Web and Staff channels only, structured meal plan, one fallback plan (S73-S76) |
| D55 | **Decided: yes.** Tax and fee model with calculation bases, display, effective dates and scope; no pre-filled rates (S77) |
| D56 | **Decided: yes.** One issues engine for accommodation and pricing; "request access" is a plain message (S78-S79) |
| D57 | **Decided: yes.** Payment terms per rate plan in the first release: full online payment and pay at hotel; deposits later |

## Page 14 — Availability (sidebar item "Inventory")

**Design source:** three Figma PNGs from a section with four tabs (Overview, Restrictions, Manual Blocks, Conflict Review): **Availability overview, Availability restrictions list, Create availability restriction.** The **Manual Blocks and Conflict Review tabs have not been supplied.** The current dashboard's "Inventory" section is a placeholder that says restrictions and manual blocks are planned; this is that feature.

**Note on D28.** Earlier you said to ignore "Open full availability management" in the calendar design. Now that you have sent this section, I treat Availability as **in scope**. Please correct me if not (D58).

**What exists today:** (1) **property-level booking rules** (minimum stay, maximum stay, advance booking days, check-in and check-out times), applied when a quote is made; (2) **manual blocks** (dates and targets only) created from the calendar; (3) Clock hotels: Clock's own stop-sale and minimum-stay data is read into the calendar. **There are no scoped or dated restrictions, no closed-to-arrival or closed-to-departure, no stop-sell rule other than a block, no restriction priority or lifecycle, and no conflict detection.** The existence of property check-in and check-out times also answers part of D14: per-booking times are an optional override of those defaults.

### 14a — Availability overview

| Design element | Class | Notes |
| --- | --- | --- |
| Chips and tiles: "86% open (412 of 480 sellable room nights in the next 30 days)", active restrictions (by type), manual blocks (maintenance, operational hold), needs attention | Derivable | Counts from availability, blocks and the new restrictions |
| Upcoming availability coverage grid (listing x day; "3/4", "Low", "Sold out", "Stop sell", "Closed arrival", "Blocked", "Provider stale") | Partial | Free-unit counts, blocks and Clock closed days exist; restriction markers new (G85); same data as the Calendar's Availability view (S87) |
| Active restrictions table, restriction health, upcoming schedule bars | **Gap** | G85 |
| Manual blocks list ("local exact-unit blocks"): unit, listing, reason, period, status, who | Partial | Blocks exist; reason and creator G41 |
| Provider and inventory health (source, connection, last incremental sync, last full validation, provider units received and mapped, horizon checked, failed operations) | Derivable | Clock hotels only; native hotels show "MUST" as source |
| Booking eligibility pipeline counts (active listings, with pricing, with active units, mapped units, units without block, active checkout locks, restrictions evaluated, final booking-ready listings) | Derivable | Uses the readiness engine (G51) |
| "How availability is calculated" (provider inventory, active mapped unit, no reservation or lock conflict, no manual block, stay passes restrictions, valid price) | Rule | Matches how search should behave; the sequence must be the same code path as the real search (S83) |
| Availability needs attention (conflicting minimum-stay rules, stale provider validation, restriction ending soon), recent activity, quick actions | Partial | Conflict detection G90; the issues come from the shared engine (S78) |

### 14b — Restrictions list

| Design element | Class | Notes |
| --- | --- | --- |
| Restriction table: rule and reference (RST-2026-0018), type (minimum stay, maximum stay, closed arrival, closed departure, stop sell, minimum advance, maximum advance), scope, period, effect, priority, lifecycle (Draft, Scheduled, Active, Paused, Expired), validation (Healthy, Warning, Conflict), updated by | **Gap** | New model (G85); today only property-wide numbers |
| Status filters with counts, search, type, scope, lifecycle, validation, "in effect today", priority, export | Gap | G85 |
| Upcoming restriction schedule bars, restriction health, evaluation order, recent activity | Partial | Schedule bars reuse the timeline component (C26) |

### 14c — Create availability restriction

| Design element | Class | Notes |
| --- | --- | --- |
| Basic information (name, reference, purpose, lifecycle) | Gap | G85 |
| Rule type cards and effect (minimum nights, date applicability "arrival date falls inside period") | Gap | G85 |
| Scope (entire property, selected categories, selected listings), rate-plan applicability, scope preview | Gap | Categories are first-release (D33); G85 |
| Effective schedule (start, end, no end date, every day or selected weekdays, daily activation times, property time zone "Europe/Tirana UTC+02:00") | Gap | Time zone see G72 |
| Priority (Low 25, Normal 50, High 75, Critical closure 100) and overlap policy | Gap | S82 |
| Validate and activate (save draft, or activate after validation); internal reason and review owner | Gap | G85 |
| **Booking effect preview** (test stays: arrival, departure, length, result Passes or Rejected with the reason) | Gap | G86; valuable, see S83 |
| Affected coverage (listings, rate plans, combinations, arrival evaluations), conflict and overlap check, activation checklist, next validation state | Derivable | |
| Restriction boundaries ("does not create inventory, change prices, block exact units, cancel reservations, **write availability to Clock PMS**") | Rule | Consistent with S81 |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S81 | **One source per hotel for restrictions too.** Clock hotels: this section shows Clock's restrictions read-only (Clock already supplies stop-sale and minimum-stay data); native hotels: MUST's own restrictions. Blocks follow D30 | Same reasoning as inventory (D35) and pricing (D49) |
| S82 | **Restriction semantics:** restrictions of different types combine (a stay must satisfy all of them); within the same type and overlap, the **higher priority wins** (so a short exception can relax a general rule); equal-priority contradictions are a blocking conflict | Matches the design's "equal-priority conflicts are blocking" and D51 |
| S83 | **The booking-effect preview and the live search must run the exact same evaluation code**; the same function answers "is this stay allowed" for the website, staff booking and the preview | Otherwise the preview can promise something search does not do |
| S84 | **First release rule types:** minimum stay, maximum stay, closed to arrival, closed to departure, stop sell, minimum advance. Leave maximum advance, daily activation times and recurrence beyond weekdays for later | Covers what hotels actually set |
| S85 | **Fixed priority levels** (Low, Normal, High, Critical) as the default control, numeric field in advanced | Easier than free numbers |
| S86 | **Property-wide numbers migrate:** today's property minimum stay, maximum stay and advance days appear as base restrictions (read-only here, edited in Settings or converted into rules) | Avoids two places defining the same rule |
| S87 | **The coverage grid is the Calendar's Availability view** at a coarser level, not a second implementation | One data path |

**Decisions needed**

| # | Question |
| --- | --- |
| D58 | **Decided: yes.** The Availability section is in scope (this replaces the earlier "ignore" answer for D28) |
| D59 | **Decided: yes.** One source per hotel for restrictions (Clock hotels read-only); restrictions of different types combine, higher priority wins within a type (S81-S82) |
| D60 | **Decided: yes.** Same evaluation code for search and preview, first-release rule types, fixed priority levels, property numbers become base restrictions, coverage grid reuses the calendar (S83-S87) |
| D61 | **Owner: there is no Photos page in the new design.** Photos are handled inside the listing editor (cover image and gallery). Where the property photo library lives is open (D62). Manual Blocks received; Conflict Review tab still awaited |

### Page 14d — Restriction detail / edit (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Header: name, reference, status badges (Active, Upcoming, Validation healthy, No conflicts); "Changes can affect future booking searches" banner with Preview change impact / View current effect | Gap | G85 |
| Sections as in Create (basic, rule type and effect, scope, schedule, priority, validation and change application, internal notes) with "version 4" on the record | Gap | Versioned restriction (G85, G96) |
| "Changing rule type resets incompatible effect fields and requires full validation"; "material changes (type, effect, scope, dates, recurrence, priority) must be validated before applying; notes and owner save without revalidation; conflicts cannot be ignored or force-overridden" | Rule | Good; see S91 for the same idea on blocks |
| Booking effect preview with "Current saved rule" and "Unsaved changes" tabs | Gap | G86 |
| Affected coverage (listings, rate plans, combinations, **future bookings reviewed 7, confirmed bookings modified 0**), Validation health, Change impact | Gap | Existing confirmed bookings are never modified (consistent with the pricing rule) |
| **Restriction usage** (booking searches evaluated 284, stays rejected 37, passing 247, most recent evaluation) | Gap | Needs logging every search evaluation (S88) |
| Lifecycle actions: Pause, Archive, Duplicate; "active restrictions cannot be deleted" | Gap | Archive state G64 |

### Page 14e — Manual blocks list (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Chips and tiles (2 active, 8 room nights blocked, units affected 2 / 15, needs attention) and status tabs (All, Active, Scheduled, Draft, Ended, Cancelled, Conflicts) | Partial | Blocks exist; lifecycle states are new (G92) |
| Table: block title and reference (BLK-2026-0032), reason tag (Maintenance, Safety inspection, Operational hold, Owner use, Deep cleaning, Out of service, Staff hold), unit and listing, period (whole days or a time window such as 10:00-14:00), effect (room nights blocked, temporarily unavailable), lifecycle, schedule (In effect, Ending soon, Upcoming, Ended), validation, updated by, action | Partial | Dates, scope and type exist; the rest G92 |
| Filters: reason, listing, unit, lifecycle, schedule, validation, window, ending soon | Derivable | Once G92 exists |
| Upcoming block schedule bars, block health, **blocked-unit coverage**, boundaries card ("exact units only; no pricing or housekeeping changes; no Clock room-status write; no automatic cancellation; reservation or checkout-lock overlap goes to Conflict Review") | Partial | Bars reuse C26 |
| Recent activity | Partial | G24 |

### Page 14f — Create manual block (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Block identity: title, **reason**, internal reference (work order), purpose | Gap | G92, G41 (decided yes) |
| **Exact room-unit scope** (room type, then a mapped unit; "manual blocks never target a generic quantity") | Partial | Today a block can target the whole property, room types or specific rooms; room-type-only hotels have no units. See S89 / D63 |
| Blocked period: block start date **and time**, available-again date **and reopen time**, blocked nights, "calendar interpretation" (unavailable for the nights of 27 and 28 July; sellable again from 29 July at 11:00) | Partial | Dates exist (end date is exclusive); **time of day does not** (S90) |
| Conflict validation (confirmed reservation overlap, active checkout inventory locks, existing manual blocks, provider freshness) | Gap | Detection G93; checkout locks are the payment-pending holds that already exist |
| Inventory impact preview, calendar preview, creation checklist, state after save | Derivable | |
| **Provider synchronization** (Clock: local validation passed, "after create: pending provider confirmation") | Gap | D30 says yes to pushing blocks to Clock; **the Clock write path for a room-level closure is unverified and must be proven against the sandbox first** (G94, S93) |
| Internal ownership: **responsible staff, technician or vendor, work order**, notes; "early reopening requires a reason" | Gap | G92 |
| Audit behavior (versioned edits, validation snapshot, synchronization attempts) | Gap | G92 |
| Save draft, Validate block, Create manual block | Gap | Draft lifecycle G92 |

### Page 14g — Edit manual block (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Header status badges (Active, Synced), "changes can affect sellable inventory immediately; shortening reopens, extending removes nights" banner | Gap | |
| **Scope locked while active** ("end it and create a new block to change scope"); period editable; proposed inventory effect and calendar comparison (saved vs proposed) | Gap | S91 |
| Change validation, provider synchronization ("saving creates a versioned Clock update"), validation health, change checklist | Gap | G92, G94 |
| Lifecycle: **End block early** (reason required), history with provider reference | Gap | |
| Internal notes and ownership, activity and audit history, source-of-truth card | Gap | G24 |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S88 | **Leave out restriction usage counters** (searches evaluated, stays rejected) in the first release | Needs logging every search; the preview already answers "what would this rule do?" |
| S89 | **Keep all three block scopes: a specific unit (default when units exist), a room type, or the whole property.** Do not restrict blocks to exact units only | Room-type-only hotels have no units, and closing a whole hotel or room type is common |
| S90 | **First release blocks are date-based** (blocked from a start date until an available-again date). Time-of-day windows (for example 10:00 to 14:00 inspections) are kept as a note, not as inventory logic | Sellable inventory is counted per night; same-day windows change no sellable night |
| S91 | **Block edit rules:** the scope is fixed once the block is active (end it and create a new one); the period can be extended or shortened after validation; ending early requires a reason; conflicts with reservations or holds are a hard stop | Matches the restriction rules (D59) and protects confirmed stays |
| S92 | **One reason list for blocks:** Maintenance, Renovation, Safety inspection, Deep cleaning, Owner use, House or staff use, Event, Out of service, Other (merges the earlier D29 list and this design's tags) | One list, used everywhere |
| S93 | **Verify what Clock supports for room-level closures before promising the sync;** fall back to a room-type stop-sale if room-level out-of-order is not available | D30 says push blocks to Clock; the write path is unproven |
| S94 | **Reduce ownership fields to responsible staff, reference (work order) and notes;** technician or vendor goes into the notes | Fewer fields staff skip |

**Decisions needed**

| # | Question |
| --- | --- |
| D62 | **Decided: yes (owner: the property photo library is already built).** It becomes a picker inside the listing editor's gallery; no separate Photos page |
| D63 | **Decided: yes.** Blocks can target a unit, a room type or the whole property (S89) |
| D64 | **Decided: yes.** First-release blocks are date-based; time windows are notes (S90) |
| D65 | **Decided: yes.** One reason list for blocks (S92) |
| D66 | **Decided: yes.** No usage counters, block edit rules, verify Clock room-level closure first, fewer ownership fields (S88, S91, S93, S94) |
| D67 | **Resolved:** Conflict Review and Availability states received |

### Page 14h — Conflict Review (design received 2026-10-16)

**Design source:** Figma PNG "Availability conflict review". It resolves cases where three sources disagree about one unit (example: a local manual block says blocked, Clock says sellable, and a customer checkout holds the unit for twelve minutes). Safety rule: **booking safety wins and the unit stays unavailable until resolved**.

| Design element | Class | Notes |
| --- | --- | --- |
| Conflict queue (severity, reference CF-2026-0071, kind: provider mismatch, date mismatch, sync delayed, checkout lock), queue health, assignment coverage | Gap | G93, G90; one issues engine (S78) |
| Conflicting state comparison (local, Clock, booking safety), evidence timeline, affected entities | Partial | Block, Clock availability and payment-pending holds are separate data today; no comparison or timeline |
| Resolution decision (keep blocked, reapply block in Clock, cancel the release request), retry validation, resolution readiness, guardrails, Resolve | Gap | Mostly **Clock-hotel only**. A native hotel has one source of truth, so only local-versus-checkout-lock conflicts can occur |
| Assign to me, owner, SLA | Gap | Assignment deferred (D47); see S95 |
| Run full validation, Export evidence, Provider diagnostics | Partial | Technical content goes to platform admin (D23) |

### Page 14i — Availability states reference (design received 2026-10-16)

Documentation page with six states (fresh empty, filtered empty, setup required, **provider degraded**, load failure, read-only) and a behavior matrix. Same pattern as the Pricing states (S28). New here: a **provider-degraded** mode that shows local data, labels Clock values "Unknown" (never stale values), and **blocks writes** until Clock freshness returns. This matches S38 and the calendar stale mode (G46). The rule "never say no availability when data failed to load" is adopted.

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S95 | **First release Conflict Review is a read-only list of mismatches with the safe default applied automatically (unit stays unavailable) and one action per case: retry validation or end the block with a reason.** Assignment, SLA and evidence export come later | Conflicts only exist for Clock hotels and are rare; the safe default already protects bookings |
| S96 | **Show Conflict Review only for hotels with an external PMS** | Native hotels cannot have a provider mismatch |
| S97 | **Provider-degraded mode is a shared behavior (calendar, availability, pricing):** show local data, label provider values Unknown, disable writes, offer Retry | One rule everywhere |

**Decisions needed**

| # | Question |
| --- | --- |

## Page 15 — Payments

**Design source:** four Figma PNGs from a section with six tabs (Overview, Ledger, Refunds, Reconciliation, Clock folios, Gateways): **Payments overview, Payment ledger, Payment detail (PAY-1084), Create refund request.** The **Refunds, Reconciliation, Clock folios and Gateways tabs were not supplied.** **What exists today:** `payments.tsx`, `payment-detail.tsx`, `payment-refund-dialog.tsx`; tables `payments` (kind CHARGE or REFUND, provider, external payment id, status, amount, currency, method, note), `payment_provider_sessions`, `provider_events` (RECEIVED, QUEUED, HYDRATED, IGNORED, FAILED, NEEDS_RECONCILIATION), `clock_folios` (deposit flag, balance, closed time), payment expiry (releases unpaid holds), a payment ledger service, a refund service (amount or percentage, note, Clock reversal), Clock payment reconciliation, and manual-review items of type payment-booking mismatch. Payment methods in the system: Stripe checkout, PokPay, pay at hotel, free. The design speaks only about PokPay; it must be provider-neutral (S98).

The design's **core rules agree with how the system already works** and should stay visible in the UI: provider evidence (a signed webhook or a server-side recheck) is authoritative and a browser return never confirms a payment; there is no manual "Mark paid" for online payments; one active attempt per checkout and a definite failure releases the inventory hold; unknown results become "reconciliation required"; confirmed bookings and payment snapshots stay immutable; a Clock accounting failure does not undo a valid payment.

### 15a — Payments overview

| Design element | Class | Notes |
| --- | --- | --- |
| Tiles: confirmed revenue, confirmation pending (inside the verification window), reconciliation required, refund exposure | Derivable | From payment statuses, provider events and refunds; each state needs one written definition (G97) |
| Chips: provider online, verification authoritative, confirmed count, "Clock folio 23/24 verified" | Derivable | Clock chips for Clock hotels only (S105) |
| Payments requiring attention (confirmation not received with Recheck, expired verification with Review, refund needing manual review, Clock folio retry) | Partial | The mismatch cases and expiry exist; staff-triggered "recheck provider payment" and "retry Clock folio posting" must be verified or added (G98) |
| Recent provider-confirmed payments (with "Folio verified / Folio pending"), refunds and reconciliation snapshot, recent payment activity | Derivable | Audit log and provider events (G24) |
| Payment integrity and lifecycle cards | Rule | Static explanations; keep short (S104) |
| Provider health (API and webhook, verification queue, Clock folio accounting, refund execution) | Partial | Same sources as System health (G4); technical parts stay in platform admin (D23) |
| Quick actions (ledger, reconciliation, create refund, Clock folios, gateway configuration, verify credentials) | Partial | Credential verification exists in Settings > Integrations (D71) |

### 15b — Payment ledger

| Design element | Class | Notes |
| --- | --- | --- |
| Table: payment id (PAY-1084), provider and provider reference, booking and guest, stay, amount, **provider evidence** ("webhook confirmed 12:42", "return received, no authoritative confirmation", "verification window expired"), booking and accounting state (booking confirmed, Clock deposit folio verified, hold retained), status (Confirmed, Verifying, Reconcile, Folio retry, Refund review, Failed, Refunded), action | Partial | Core fields exist; the "evidence" and the separated lifecycles must be derived from payment status, provider events and folios (G97). Local ids such as PAY-1084 need a human-readable reference (G99) |
| Filters: search, payment state, provider, accounting state, date range; Export CSV | Partial | Export is gated by permission and audit (G21) |
| Safeguards card, recent ledger activity, "provider-backed payment states only" banner | Rule | |

### 15c — Payment detail

| Design element | Class | Notes |
| --- | --- | --- |
| Header chips (payment confirmed, booking confirmed, webhook verified, folio verified, refunds, amount), actions Recheck provider and Create refund | Partial | G98 |
| Four tiles (amount captured, provider result, booking state, Clock accounting) | Derivable | |
| Provider payment evidence (provider, local id, provider order, provider transaction, attempt id, verification source, signature check, idempotency key) | Partial | Provider order and transaction ids and signature verification exist in sessions and events; attempt id and a displayed idempotency key need checking. Hotel staff do not need raw keys (S106) |
| Booking linkage (booking, guest, stay, inventory committed, confirmation email sent, Clock reservation id) | Derivable | |
| Payment evidence timeline (checkout attempt, order created, return received, webhook verified, confirmed, booking confirmed, folio posted, folio verified) | Partial | Events exist in pieces (provider events, audit log); a per-payment timeline does not (G24, G100) |
| Lifecycle states, amount breakdown (room subtotal, taxes and fees, customer total, captured, refunded, net) | Partial | Breakdown depends on the pricing snapshot (G75) |
| Clock deposit accounting (deposit folio, required deposit, balance, posting mode) | Real (Clock hotels) | Folio data exists |
| Audit and safeguards, record metadata (created by Public checkout, last actor, retention) | Partial | Actor fields partly exist |
| Refunds and reversals, Download evidence | Partial | Download evidence is a technical bundle (S106) |

### 15d — Create refund request

Four-step form (Scope, Amount & reason, Provider & Clock, Review), summary and eligibility on the right, execution sequence, validation checklist, audit rules; ends with Submit for manual review, Save draft, Cancel.

| Design element | Class | Notes |
| --- | --- | --- |
| Operation: Refund only or Refund and cancel reservation; refund type: maximum refundable or custom partial amount | Partial | Refund by amount or percentage exists; cancellation currently drives its own refund; making them two explicit operations is new (G34, S101) |
| Amount and fee policy: captured amount, provider fee 3% (€16.20) retained from the customer refund, refund amount, "inside the 21-day cancellation window blocks automatic refund" | Gap | Provider fees are not stored; a cancellation policy with a time window exists per rate plan (G101, S100) |
| Reason (required), requested by, internal note, customer message with "notify guest after approval" | Partial | Refund note exists; reason category, customer message and requester are new (G102) |
| Provider execution: PokPay API after approval or manual dashboard fallback, "manual_pending" state | Partial | A PokPay refund path exists (provider refund with Clock reversal after success); the manual fallback state must be confirmed against the code (G103) |
| Clock reversal preview (negative payment on the original deposit folio, only after the provider refund succeeds) | Real (Clock hotels) | The refund service already posts a Clock refund; a preview is new |
| Review acknowledgements (three "Confirmed" checkboxes) and evidence note | Gap | Remove (S104, same reason as S18) |
| Eligibility, execution sequence, validation checklist, audit safeguards; "Submit for manual review" instead of executing | Gap | An approval step for refunds does not exist; see D69 / S99 |

### 15e — Not supplied

Refunds (list of refund requests and approvals), **Reconciliation** (unknown-result queue), **Clock folios** (deposit and folio accounting) and **Gateways** (configuration, credentials). The overview and detail pages already point at all four, so they cannot be left out. Gateways overlaps with the payment methods and integrations settings that exist today (D71).

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S98 | **Provider-neutral wording everywhere:** "payment provider" with a badge (PokPay, Stripe, Pay at hotel, Manual); Clock-specific parts only for Clock hotels | The design is PokPay-only; the product supports more |
| S99 | **Refund workflow like cancellations (S24): staff with the refund permission refund directly within policy; the request-for-manual-review path is used for exceptions** (inside the restricted window, over a limit, or a missing permission) | Two-step approval on every refund slows the desk; the design's "manual review required" is the exception case |
| S100 | **Show the provider fee only when the provider reports it; otherwise omit the fee line.** Do not invent a fixed 3% | A fee that is not recorded cannot be displayed accurately |
| S101 | **Two explicit operations: "Refund" and "Cancel reservation and refund"**, each audited separately, matching the design | Today's cancellation silently refunds; staff need both options |
| S102 | **One human-readable reference for every payment** (PAY-1084) shown in lists and detail | Staff and guests talk in references, not UUIDs |
| S103 | **Recheck provider and Retry Clock folio are idempotent buttons** with a clear result message; neither can create a duplicate payment or posting | Matches "retries append evidence" in the design |
| S104 | **Keep the integrity rules as short help text, not large cards; remove the three review acknowledgements** | Same reasoning as S18; the validation checklist already blocks unsafe refunds |
| S105 | **Clock folio, deposit and accounting sections appear only for hotels with a Clock connection** | Native hotels have no folios until Milestone 25 |
| S106 | **Hotel staff see payment status, provider reference and timeline; raw idempotency keys, signature checks and "download evidence" go to the platform-admin area** | Technical evidence is for operators (D23) |

**Decisions needed**

| # | Question |
| --- | --- |
| D68 | **Decided: yes.** Conflict Review is a read-only list first, Clock hotels only, with the shared degraded-provider mode (S95-S97) |
| D69 | **Decided: yes.** Refund directly within policy; manual review only for exceptions (S99) |
| D70 | **Decided: yes.** Provider-neutral wording, provider fee only when reported, two explicit refund operations, payment reference, idempotent Recheck and Retry, short help text with no acknowledgement checkboxes, Clock sections for Clock hotels only, technical evidence in platform admin (S98, S100-S106) |
| D71 | **Decided: drop the Gateways tab from Payments.** Gateway and credential configuration stay in Settings (design content kept as input for the Settings page, see 15i) |
| D72 | **Received:** Refund review, Reconciliation, Clock folios, Gateways, Credential verification. Still awaited: Guests, Staff, Settings, Reports, Notifications, platform area, owner's all-hotels dashboard |

### Page 15f — Refund review (approval of a refund request; design received 2026-10-16)

Review of "RF-DRAFT-20260724-01": four-step status (Request submitted, Staff review, Provider execution, Accounting & notify); request summary, reason and evidence, **policy exception review** (request is valid but check-in is inside the 21-day window so it cannot auto-execute), provider execution readiness, booking and Clock impact, risk and readiness, approval consequences, execution sequence, audit safeguards; **reviewer note** and three acknowledgements; **Reject request** / **Approve & execute refund**.

| Design element | Class | Notes |
| --- | --- | --- |
| Request, payment, booking, requester, amount, provider fee | Partial | Same gaps as 15d (G101, G102) |
| Policy exception review (cancellation window) | Partial | Policy window exists per rate plan; "exception" as a reviewable state is new (G103) |
| Provider execution (server-side attempt, fallback, unknown result goes to reconciliation, success appends evidence then Clock) | Partial | The sequence already matches the refund service (provider success first, Clock reversal after) |
| Reviewer decision: required note, Reject, Approve & execute | Gap | Approval entity (G103), reuses the one requests-and-approvals model (S23) |
| Three reviewer acknowledgements | Remove | S104 |

### Page 15g — Reconciliation (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Case queue: case id (REC-012), payment and provider reference, expected state and owner with age, amount, provider evidence (API confirms paid but webhook not received; return received without authoritative result; verification expired; refund confirmed but Clock reversal pending; duplicate success event; provider failure vs local paid), local impact, status (Repair ready, Verifying, Required, Clock gap, Duplicate, Conflict, Resolved), action (Review, Recheck, Inspect) | Partial | Every case type is a state the system already detects (provider events needing reconciliation, payment-booking mismatch, expired verification, duplicate events). A **case record with id, owner and status** does not exist (G105); today they appear as manual-review items and statuses |
| Chips and filters (open, resolved today, verifying, action required, evidence gaps, oldest age; mismatch type, provider, owner) | Derivable | |
| Run reconciliation, Export evidence, Review oldest case | Partial | Reconciliation jobs exist for Clock; a staff-triggered run and export are new (G98, G21) |
| Safeguards (provider truth first; no manual mark-paid; independent repair of payment, booking, inventory and Clock; idempotent audit trail), recent activity | Rule / partial | |

### Page 15h — Clock folios (design received 2026-10-16)

| Design element | Class | Notes |
| --- | --- | --- |
| Queue of Clock postings for payments and refunds: payment and booking, Clock booking and folio, amount, expected posting (positive payment item or negative credit item), posted evidence (item number, balance verified), status (Verified, Retry needed, Reversed, Blocked, Folio missing, Protected, Review), action (View, Retry, Repair, Inspect, Review) | Partial | `clock_folios` and posting logic exist; the queue view and the staff **Retry / Repair** actions need to be verified or added (G98) |
| Chips (24 payments, 23 verified, 1 pending, balance gap, duplicates, synced N min ago), "Verify folios", Export folios | Derivable / partial | Clock hotels only (S105, S109) |
| "Clock is downstream accounting, not payment truth" banner, safeguards | Rule | Matches the current design of the adapter |

### Page 15i — Gateways and credential verification (design received 2026-10-16; **tab dropped from Payments, D71**)

Two screens: **Gateway configuration** (PokPay as primary gateway; environment and merchant account; public checkout policy; callbacks and webhooks with last delivery, copy endpoints and **Test callback**; verification window, polling, retry policy, unknown result handling, idempotency key) and **Credential verification** (masked credential set, rotation date, **Rotate credentials**, four non-mutating checks, a **production activation gate**, credential audit, safeguards).

These belong in **Settings** (Payments methods and Integrations), where connection testing and credential storage already live. What this design adds beyond today's settings:

| Element | Class | Notes |
| --- | --- | --- |
| Masked secrets, connection test | Real | Credentials are stored encrypted and never returned; connection tests exist |
| Last webhook delivery, webhook endpoint display, copy endpoints, Test callback | Partial | The webhook endpoint exists; delivery history exists as provider events; a test call is new (G106) |
| Verification window, polling interval, retry policy | Partial | These are system settings today, not per-hotel configuration; **display only** (S110) |
| Credential rotation with versions (v1, v2, v3), retired versions, credential audit | Gap | Today credentials are replaced in place; versioned rotation and history are new (G107) |
| Staging versus production, "production blocked until a separate credential set and merchant approval" | Needs definition | Environment is controlled by deployment configuration (the API base URL), not by a per-hotel switch; a per-hotel environment selector would be new and risky (S110) |
| Public checkout policy ("offline methods disabled") | Rule | Per-hotel enabled methods exist in Settings (Pay at hotel, Stripe, PokPay) |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S107 | **Refund review is the exception path of S99:** the request page for refunds outside policy, over a limit or without the permission; the reviewer writes a required note and approves or rejects. No acknowledgement checkboxes | One approval model (S23), no ritual clicks |
| S108 | **Reconciliation cases are derived from existing states first** (a list built from payments, provider events and manual-review items, with a stable case id) and gain stored owner and notes later | Gives staff the queue now without a new workflow |
| S109 | **Clock folios and Clock postings live in one place, shown only for Clock hotels,** with idempotent Retry and Repair buttons that never create duplicates | Same rule as S103 and S105 |
| S110 | **Gateway configuration lives in Settings. Show the environment (TEST or LIVE) read-only per connection with a clear badge; do not offer a per-hotel environment switch.** Verification window, polling and retry policy are shown as read-only system behavior | Switching environments per hotel invites live payments in test mode and the reverse |
| S111 | **Credential rotation = replace with new credentials, verify them with the non-mutating checks, then activate, with the change audited; keep old versions retired, not deleted** | Safe rotation without downtime; a visible version history can come later |
| S112 | **Webhook diagnostics (copy endpoints, last delivery, test callback) are visible to owners and admins in Settings; deeper provider diagnostics stay in platform admin** | Owners need the endpoints to configure PokPay; operators handle the rest (D23) |

**Decisions needed**

| # | Question |
| --- | --- |
| D73 | **Decided: yes.** Refund review is the exception path; reconciliation cases are derived from existing states first; Clock folios and postings live in one place for Clock hotels (S107-S109) |
| D74 | **Decided: yes.** Gateway settings live in Settings with a read-only environment badge; simple credential rotation; webhook diagnostics for owners and admins (S110-S112) |
| D75 | **Resolved:** Guests, Staff, Settings, Reports, Notifications received; the platform-admin area and the owner's all-hotels views are planned in-house |

### Page 15j — Payments empty and error states (design received 2026-10-16)

A reference sheet in the same pattern as the Pricing and Availability states sheets: three empty states (no payments yet, no filtered results, queue clear), **provider degraded or offline** (customer sees "payment temporarily unavailable"; staff run diagnostics and **never mark paid**), **unknown payment outcome** (booking stays pending, inventory hold kept through the verification window, route: provider check then reconciliation), and downstream errors (Clock posting failed: retry idempotently; balance mismatch: flag an accounting gap; duplicate webhook: ignore; delayed webhook: keep booking pending; never show false success).

| Element | Class | Notes |
| --- | --- | --- |
| Empty, filtered-empty and "queue is clear" panels | Real (UI) | The standard panels (S28, C14) |
| Provider degraded: public message "payment temporarily unavailable" | Partial | The guest-facing checkout already handles provider failure; the exact message and the staff view follow the shared degraded-provider mode (S97) |
| Unknown outcome behavior, duplicate and delayed webhook handling, idempotent Clock retry | Real | Already how the system behaves (provider events, idempotency, expiry); the sheet documents it and needs no new feature |
| "View state map", "View recovery queue", "Run diagnostics", "Open reconciliation", "Recheck provider" | Partial | Recovery queue = reconciliation (G105); diagnostics is technical (platform admin, D23) |
| Recent state recovery activity | Partial | G24 |

No new decisions. It is applied as the standard states of the Payments section, and its messages are used as the copy for those states.

## Page 16 — Guests

**Design source:** six Figma PNGs: **Guest directory, Filtered directory, Guest profile, Edit guest, Reservation history, Flags & internal notes, Empty & error states** (the last two share one image). **What exists today:** `guests.tsx` and `guest-detail.tsx` over the guest endpoints (list with search, **suspected duplicates**, **merge**, **dismiss duplicate**); the `guests` table is **per organization** (tenant), not per hotel, and stores email, phone, first and last name, address fields, and duplicate and merge links. Guest matching on booking creation already exists.

| Design element | Class | Notes |
| --- | --- | --- |
| Header, Add guest, Export guests, Guest stays | Partial | Guests are created through bookings today; manual add is new (G113). Export needs permission and audit (G21). "Guest stays" is not defined; it is covered by the reservation history (S116) |
| Chips: guest profiles, returning guests, profile flags, updated N min ago | Derivable | Returning = more than one stay (G114) |
| Search (name, phone, email, guest ID), guest type filter, hotel filter, sort (last activity, next stay) | Partial | Search by name, email and phone exists; guest id G109; type, hotel and sort are new server-side options (G16 pattern) |
| Table: avatar, name, **guest ID (GST-1248)**, **masked phone**, stay profile (returning, first-time, new on-request), last and next stay, source and created (Direct, Website, OTA linked, Request), bookings count, flags (VIP, Flagged, Clear, Missing, Preference), lifetime value | Partial | Guest id G109; phone masking by permission G111; source from the first booking (G17); stay dates derivable from bookings; **flags G110**; lifetime value derivable (G115) |
| Filtered directory with removable filter chips, "Search within filtered guests", Export results | Derivable | Same chips component (C9) |
| Profile: header badges (Returning, VIP, **Contact verified**), tiles (contact coverage "email + phone verified", stay profile, next stay, lifetime and outstanding balance) | Partial | **Contact verification is not stored** (G112); outstanding balance derivable |
| Profile: identity and preferences (guest id, since, phone, email, country, preferred language, primary hotel, guest type, preferences text, contact access "permitted staff only") | Partial | Country and preferred language are new fields (G12, G25); primary hotel derivable from stays; preferences are free text (G110) |
| Profile: upcoming stay and account (payment state, outstanding balance, Clock sync, Clock reservation id, next check-in time), latest activity, Open reservation, Add note | Derivable / partial | Clock chips for Clock hotels only; activity G24 |
| Edit guest: full name, email (changed highlighting), phone, country, language, preferences; change summary and save effects ("reservations and payments unchanged, history preserved"); **"email verification required after save"** | Partial | Guest fields are editable via the API; one "full name" field maps to first and last name; **email verification flow does not exist** (G112, S119) |
| Reservation history: totals, completed stays, nights, next stay, lifetime value, table (reservation id and created, property and room, stay and guests, source, stay status, payment, total) with filters | Derivable | Uses the reservation list data (G16, G17); "Completed" is a derived status for past stays |
| Flags and internal notes: active flags (priority High or Information, category, owner team "Guest Ops", expiry, review date), internal notes (profile-wide or linked to a reservation, with author and time), visibility "permitted staff only", **archive only, never delete**, audit | **Gap** | Neither flags nor guest notes exist (G110, G25) |
| States sheet: no guests yet, no filtered results, missing contact data ("keep incomplete, request update"), **possible duplicate ("compare profiles, never auto-merge")**, permission restricted (mask private fields), profile load failed (never show a partial profile), profile save failed (preserve unsaved edits, retry), note or flag failed | Real / partial | Duplicate detection and manual merge already exist and match the rule; the rest are the standard states (S28) |

**Privacy and scope.** Guest profiles are organization-wide in the data, but a hotel's staff should only see guests who have a booking at **their** hotel, and the owner sees all (D5, D76). The design's "Guest-data permission required" matches the existing `guests.manage` capability. Data retention, erasure and consent rules are **not decided here**: the design shows "archive only" and "marketing consent is not edited here", and no consent is stored. These follow the open legal question in Milestone 25 (item 7) and ADR-0009 and need confirmation per country before any promise is made.

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S113 | **Directory shows only guests with a booking at the selected hotel;** the owner's all-hotels view (G15) can show the whole organization | Staff of one hotel should not browse another hotel's guests |
| S114 | **Human-readable guest ID (GST-1248) per organization, generated automatically** | Staff and guests refer to references, not UUIDs (same as S102) |
| S115 | **Flags are a small fixed set with a priority and an optional review date: VIP, Accessibility assistance, Preference, Attention (internal warning).** Free-text details sit in the note; no custom flag types at first | Keeps the directory scannable; avoids a tag free-for-all |
| S116 | **Drop the separate "Guest stays" button;** the profile's reservation history and the Reservations page (with a guest filter) cover it | Same data in three places is confusing |
| S117 | **Phone and email are masked in the directory unless the staff member has the guests permission; the full value shows only on the profile** | Matches the design's privacy note with an existing capability |
| S118 | **Lifetime value = paid amount minus refunds, for the hotel in view,** shown to roles allowed to see money | A defined, auditable number |
| S119 | **Email change: save and audit it; do not build a verification flow.** Show "Email on file" and "Phone on file" instead of "verified" | We have no way to verify a phone, and verification adds a flow nobody asked for |
| S120 | **Manual Add guest is allowed and runs the same duplicate check as bookings;** it creates a profile without a booking | Front desk often records a guest before the booking |
| S121 | **Notes and flags are append-only (archive, never delete) with author, time and visibility;** notes can link to a reservation | Matches the design and the audit principle |

**Decisions needed**

| # | Question |
| --- | --- |
| D76 | **Decided (owner, clarified):** this dashboard is **for the staff of one hotel**. Everything here (guests, rooms, bookings) is scoped to the selected hotel. Cross-hotel views for the organization owner (all rooms, all guests, across hotels) are a **separate, later product surface** (G15), designed separately |
| D77 | **Decided: yes.** Guest ID, masking by permission, lifetime value definition (S114, S117, S118) |
| D78 | **Decided: yes.** Four flag types with priority and review date; append-only notes (S115, S121) |
| D79 | **Decided: yes.** Drop the Guest stays button, no email verification flow, manual Add guest (S116, S119, S120) |
| D80 | **Decided: for later.** Guest data export, retention and erasure are planned for later with a legal check (G116) |
| D81 | **Received so far:** Emails (below). Still awaited: Staff, Settings, Reports, Notifications, platform-admin area. The owner's cross-hotel dashboards are designed later (D76) |

## Page 17 — Emails

**Design source:** three Figma PNGs from a new **Emails** sidebar item with four tabs (Overview, Templates, Delivery, Configuration): **Transactional email operations (Overview), Transactional email templates, and the Template editor** ("Guest booking confirmation"). **Delivery and Configuration were not supplied.** **Relationship to Milestone 22:** this is the interface for [Milestone 22 (Email notifications)](22-email-notifications.md), whose Phases A and B (delivery log in `email_messages`, queue with retry, Resend delivery webhooks) run in production, and whose Phases C to G (recipient rules, editable templates, Email tab, pluggable transport) were planned but not started. Today the product has: `email_messages` (event type, recipient, subject, template version, status QUEUED / SENT / FAILED / DELIVERED / BOUNCED / COMPLAINED, attempts, last error, sent and delivered times), `email_templates` (template key, language, subject, body, updated by), notification topic settings and recipient rules, and an Email settings screen (`email-settings.tsx`, 931 lines). **This page therefore needs the Milestone 22 backend phases and this milestone's screens to be sequenced together (S122).**

The design's central safety rule matches what Milestone 22 recorded and verified: **a confirmation email is sent only after the canonical confirmation event** (verified payment, provider fulfilment and a confirmed booking); pending bookings send nothing; **templates change wording only, never eligibility or booking state**.

### 17a — Emails overview

| Design element | Class | Notes |
| --- | --- | --- |
| Tiles: emails sent (7 days, today), delivery rate (98.4%), pending or retrying, needs attention | Derivable | From `email_messages` statuses and attempts |
| Delivery performance bars (queued, sent, delivered, failed, **suppressed**) and by-template counts | Partial | **"Suppressed" is not a status today**; messages that were intentionally not sent are not recorded (G118) |
| Email system health: sender domain verified, from address, reply-to, transport, queue worker, last delivery, failed after retries | Partial | Provider and queue exist; sender-domain verification belongs to Milestone 22 task 18; the rest derivable |
| Template readiness table (template, audience, authoritative trigger, state Enabled / Draft, last sent) | Partial | Needs template states and versions (G119) |
| Recent email deliveries (event, recipient, reference, trigger or source, status, attempts, sent time) | Real | `email_messages` has exactly these fields |
| Safety and audit card, recent email activity, quick buttons Send test email and Email configuration | Partial | Test send is Milestone 22 task 12 |

### 17b — Templates list

| Design element | Class | Notes |
| --- | --- | --- |
| Six templates: guest booking confirmation, hotel and admin notification, payment failed or expired, **partial-fulfilment resolution**, cancellation and refund update, manual resend (template key, category, audience, authoritative trigger, locales EN and SQ, state, last sent, updated by) | Partial | Today's event types: verification, welcome, password reset, staff invitation, booking confirmed, new-booking staff notice, cancellation, refund, plus later post-stay, booking update and staff mute; **partial fulfilment** and an explicit **manual resend** are new concepts (G120, G121) |
| States: Enabled, Draft, Disabled, Needs review; filters (audience, category, locale, state, updated) | Gap | A template today is just subject and body per language; no draft or enable state (G119) |
| Readiness and locale coverage (missing Albanian translation blocks publishing; legal copy review pending), locale matrix (English 6 of 6, Albanian 5 of 6) | Partial | Language is stored per template; coverage and publish blocking are new (G119) |
| Publication boundaries ("trigger key immutable; booking and payment logic not editable; provider events cannot bypass policy; missing locale uses approved fallback only") | Rule | Matches the safe design; keep |

### 17c — Template editor

| Design element | Class | Notes |
| --- | --- | --- |
| Template identity (immutable key `booking.confirmed.guest`, authoritative trigger, category, audience, property override) | Partial | Template key exists; property override exists per property |
| Message metadata: sender name, reply-to, subject, **preheader** | Partial | Sender and reply-to are Milestone 22 task 15; preheader is new (G119) |
| Email body: visual editor with toolbar, variable insertion, source mode; **required-variable blocks** (for example a payment block must contain payment status) | Partial | Milestone 22 task 14 plans the editor and placeholder picker; required variables per template are new (S126) |
| **Plain-text fallback** (auto-generated) | Gap | G119 |
| Allowed variables list (required and optional, "unknown placeholders fail validation") | Gap | G119 |
| **Validation gate** (subject, body, required variables, unknown placeholders, links and addresses, locale fallback) before publish | Gap | G119 |
| **Versions**: live v7, working draft v8, history with Compare and Restore ("restore creates a new draft") | Gap | G119 |
| Preview with sample data (guest, booking, room, total) and **Send test email** (labelled test, no lifecycle effect) | Partial | Milestone 22 task 12 |
| Draft change summary ("what differs from live"), delivery behaviour table (save draft changes nothing sent; publish makes v8 live; automated confirmation uses live only), safety boundaries, editor audit | Gap | G119 |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S122 | **Treat Emails as the screens for Milestone 22 phases C to G and build them together:** recipients (already planned there), templates, sender, delivery log. This milestone owns the design and structure; Milestone 22 owns the backend tasks | Avoids two plans for the same feature |
| S123 | **First release: structured templates, not free HTML.** Fixed branded layout; hotels edit subject, preheader and body text blocks and insert variables from a picker; "advanced HTML" is a later option | Free HTML lets a hotel break required content (booking reference, dates, total, cancellation link) |
| S124 | **First release template set = the real event types plus a manual resend;** partial-fulfilment resolution is added only if multi-room partial outcomes are confirmed to need their own email | Do not ship templates for events nothing emits |
| S125 | **Languages: English and Albanian per hotel, guest language from the guest profile (country and preferred language, G12/G25) else the hotel default; a missing translation always falls back to the hotel's default language,** never to an empty message | Matches "approved fallback only" |
| S126 | **Required variables are enforced on publish** for each template (a confirmation must contain booking reference, dates, room, total and cancellation info); unknown placeholders block publishing | Prevents a bad template from reaching guests |
| S127 | **Add a "Suppressed" outcome with a reason** (for example pending payment, unconfirmed provider result, guest has no email, recipient muted) to the message log | Staff can see why an expected email did not go out |
| S128 | **Versioning: one live version and one draft, publish makes the draft live, restore creates a new draft;** keep history append-only | Matches the design without a heavy workflow |
| S129 | **Overview chips and health show only what exists:** sender verified appears once domain verification (Milestone 22 task 18) exists; until then show the from and reply-to addresses | No claims the system cannot check |

**Decisions needed**

| # | Question |
| --- | --- |
| D82 | **Decided: yes.** Emails is the interface for Milestone 22 phases C to G; first-release templates are structured (not free HTML); first template set is the real event types plus manual resend (S122-S124) |
| D83 | **Decided: yes.** English and Albanian with fallback to the hotel default; required variables enforced on publish; "Suppressed" outcome with a reason; one live version and one draft; health chips show only what can be checked (S125-S129) |
| D84 | **Received:** Template preview, Send test email, Configuration, Delivery failure incident, Email states. Still awaited: Staff, Settings, Reports, Notifications, platform-admin area |

### Page 17d — Template preview (design received 2026-10-16)

Desktop and phone render of draft v8 with a chosen locale, sample booking and background; a **Render verification** list (inbox metadata, desktop and mobile rendering, required variables, links, plain-text fallback, locale fallback); **draft v8 compared with live v7** table; resolved plain-text preview; "preview safety" rules (sends nothing, changes no state); activity.

| Element | Class | Notes |
| --- | --- | --- |
| Rendered preview with sample data, desktop and mobile widths | Partial | Milestone 22 task 12 plans preview; the sample booking picker is new |
| Compare draft with live | Gap | Part of G119 versions |
| Render verification and "publish blocked while a variable is unresolved" | Gap | G119 |
| Preview safety rules | Rule | Keep: preview never sends and never changes state |

### Page 17e — Send a controlled test email (design received 2026-10-16)

Explicit recipient (never taken from the sample guest), recipient type, audit note, template and version, resolved subject with a **mandatory [TEST] prefix**, resolved sample data, options, pre-send readiness (recipient syntax, sender domain, transport, template version, links, rate limit), exact test email preview, "what happens after send", audit summary (actor, permission `manage_email_templates`, template, version hash, sample, recipient, reason), recent test history; acknowledging an unresolved variable before sending.

| Element | Class | Notes |
| --- | --- | --- |
| Test send to an explicit address only, [TEST] prefix, audit with a reason, no lifecycle effect | Partial | Milestone 22 task 12 (template API with preview and send-test); audit table exists |
| Test traffic kept out of guest metrics | Gap | G123 (separate test category in the log) |
| Permission `manage_email_templates` and `manage_email_configuration`, `manage_email_credentials`, `manage_email_suppression` | Partial | The capability catalog has settings and notification capabilities; these finer keys are new (D85) |

### Page 17f — Delivery failure incident (design received 2026-10-16)

"Booking confirmation email failed; booking integrity is unaffected." Failure summary (event, booking reference, recipient, template snapshot, trigger, message id, first and last attempt, **sanitized provider response**), **booking integrity proof** (booking, payment, provider evidence, Clock, inventory, guest email, recovery action), delivery attempt timeline, recipient and suppression checks, recovery decision (**retry the same approved snapshot to the same recipient**, manual resend, wait, recreate), incident severity, retry readiness, sanitized evidence, ownership; **Retry delivery / Open booking / Manual resend / Close incident**.

| Element | Class | Notes |
| --- | --- | --- |
| Message, attempts, last error, status, retry | Real | `email_messages` has attempts, last error and statuses; the queue retries (Milestone 22 Phase B) |
| Staff **Retry delivery** (same snapshot, same recipient, idempotent) | Partial | Task "retry from the failed email" is part of Milestone 22 UI; verify (G121) |
| Incident record with severity, owner, closing | Gap | Failed messages are not incidents today; a failed row is enough for the first release (S131) |
| Suppression checks (hard bounce, complaint, unsubscribe, recent duplicate, rate limit) | Partial | Bounced and complained statuses exist; a suppression list and unsubscribe rules are new (G124) |
| Booking integrity proof | Derivable | A read of booking, payment and Clock state |

### Page 17g — Email configuration (design received 2026-10-16)

Sender identity (from name and address, reply-to with revalidation, default locale, support phone, footer name; "property override inherits global settings"), **transport** (managed API or SMTP, endpoint, credentials masked, test connection, **rotate credentials**), **domain authentication** (SPF, DKIM, DMARC, return-path, from-domain alignment), **queue and retry policy** (3 attempts, backoff 5 min, 30 min, 2 h; retry window 24 h; failed-message retention 90 days; idempotency; per-recipient rate limit), **delivery defaults and routing** (HTML, plain text, mandatory [TEST] prefix, separate test metrics, which templates are enabled, hotel notification and admin copy recipients), **provider event ingestion** (signed callback endpoint, signature verification, accepted events, last verified event), suppression and bounce handling, access and audit boundaries (permission per action), pending change impact, effective configuration.

| Element | Class | Notes |
| --- | --- | --- |
| From name, reply-to, default locale | Partial | Milestone 22 task 15 (sender settings); support phone and footer name are new branding fields (Settings branding exists) |
| Transport connection, credential rotation | Partial | Milestone 22 tasks 16 to 20 (SMTP and own transport); today the transport is Resend configured by environment variables, so this is **platform-level**, not per hotel (S130) |
| SPF, DKIM, DMARC verification | Gap | Milestone 22 task 18; needs a DNS check service |
| Queue and retry policy | Real, read-only | These are system settings today (BullMQ), not per-hotel editable (S130) |
| Delivery defaults: enabled templates, recipients, admin copy | Real | Notification topic settings and recipient rules exist |
| Provider event ingestion: endpoint, signature, last event | Real | The Resend delivery webhook exists and is verified; display and rotate secret are new |
| Suppression and bounce handling (hard bounce suppress, complaint suppress, unsubscribe, manual unsuppress with privilege) | Gap | G124 |
| Access boundaries per permission | Gap | Needs finer email permissions (D85, D87) |

### Page 17h — Email states and recovery (design received 2026-10-16)

The same state-reference pattern as the earlier sections (empty, filtered empty, configuration required, **delivery data degraded**, load failure, read-only). Uses the shared degraded and error behavior (S97, S28). No new feature.

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S130 | **Split Configuration into two levels:** (1) **hotel level** (owner or admin): from name, reply-to, default language, support phone, footer name, recipients and which templates are enabled; (2) **platform level** (platform admin): transport credentials, queue and retry policy, domain authentication, signing secret. Hotel owners see transport and domain status read-only | Hotels should not hold the credentials that send mail for every hotel; matches how Milestone 22 splits platform and property settings |
| S131 | **First release delivery view = the message log (filter by status) with a message detail and a Retry button;** a separate "incident" record, severity and ownership come later | A failed message is already the incident; no workflow around it yet |
| S132 | **Suppression list:** automatically suppress hard bounces and complaints, block sending to suppressed addresses, show why a message was suppressed, and allow a privileged **manual unsuppress** with a reason; templates cannot override it | Standard deliverability protection |
| S133 | **Finer email permissions:** view log, manage templates, send test, manage configuration, rotate credentials, manage suppression, mapped onto existing capability keys where possible | The design's permission list is reasonable; reuse the capability model |
| S134 | **Domain authentication checks run as a diagnostic (SPF, DKIM, DMARC, return path) and show pass or fail with the DNS record to add;** no live DNS editing | Hotels need to know what to ask their DNS host to change |

**Decisions needed**

| # | Question |
| --- | --- |
| D85 | **Decided: yes.** Email configuration is split: hotel level (sender, reply-to, language, recipients, enabled templates) and platform level (transport credentials, queue and retry, domain authentication, signing secret); hotels see transport and domain status read-only (S130) |
| D86 | **Decided: yes.** First-release delivery view is the message log with detail and Retry; automatic suppression of hard bounces and complaints with privileged manual unsuppress (S131-S132) |
| D87 | **Decided: yes.** Finer email permissions on the existing capability model; domain authentication shown as a diagnostic (S133-S134) |

## Page 18 — Coupons

**Design source:** six Figma PNGs from a new **Coupons** sidebar item: **Coupon list, Create coupon, Edit coupon, Usage and reservations (traceability), Expired and fully used states, Empty and error states.** This is the feature set earlier left out (G28, D19) until it was planned. **Nothing exists today:** no coupon table, no code field in the public booking flow or the WordPress plugin, no discount line in the quote, and no discount in a booking's stored price (bookings store nightly rates and a total; see G75).

**How the design works:** a coupon has an offer name, a unique **code**, a discount (percentage or fixed amount), an activation state (Draft, Scheduled, Active, Inactive, Expired, Fully used), a **booking window** (when the code can be entered), a **stay window** (which stay dates qualify), **eligibility** (public checkout, minimum spend, specific rooms, new guests only, advance days, weekdays), a **global limit** and a **per-guest limit**. The code becomes locked after its first redemption; edits apply only to future quotes and checkouts; confirmed bookings are never repriced; every redemption is traceable to a reservation and payment and can be **reversed** on cancellation and refund. Invalid or expired codes never change the quote, and if validation is unavailable the checkout uses the full price.

| Design element | Class | Notes |
| --- | --- | --- |
| Coupon list: code and offer, discount, booking and stay window, eligibility, usage (36 / 100), status, **granted total (€)**; filters by status and discount type; chips (8 coupons, 3 active, 2 scheduled, 1 fully used) | Gap | New model (G129); granted total comes from redemptions |
| Create and edit: identity and discount, windows, eligibility and limits, creation review (code uniqueness, activation, price revalidation, "existing bookings never repriced"), save effects, Save draft | Gap | G129 |
| Code locked after first use; deactivate | Gap | G129 |
| Usage and reservations page: every redemption with reservation, guest, stay, room, source, booking and payment state, discount and total; reversed uses excluded from retained totals; export usage | Gap | G130 (redemption records) |
| Public checkout: enter a code, server validates, discount shown in the quote and stored on the booking | Gap | Needs the quote engine, the checkout API, the WordPress widget and the booking snapshot (G131, G75) |
| Staff booking: apply a code in step 3 of Add reservation | Gap | G131 |
| States sheets: expired, fully used, scheduled, inactive, booking window closed, stay dates ineligible, eligibility changed (reprice and remove the stale discount), validation unavailable (use full price, retry safely); empty catalog, duplicate code, invalid rules, permission restricted, list load failed, save failed | Rule | Pure behavior definitions; they follow S28 and the quote engine's authority |

### What a coupon touches (must be designed together)

- **Quote and price order.** The final price today is base price, then (planned) pricing rules and rate-plan adjustments, then taxes (Page 13). A coupon must sit at one defined point (S135).
- **Checkout holds and limits.** A limited-use code must be reserved when checkout starts, released when payment fails or expires, and returned if the booking is cancelled, otherwise two guests can claim the last use (G132). This mirrors how inventory holds already work.
- **Payments and refunds.** The charged amount is the discounted total. A refund after a coupon must refund what was paid, and the Payments screens show the discount line (Page 15).
- **Pricing snapshot.** The booking must store the coupon code, discount type and value, and the amount discounted (G75).
- **WordPress plugin.** The public booking widget needs a coupon field and clear messages for each rejection reason (G131).
- **Reports.** Granted total and net discount feed Reports (not yet received).

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S135 | **Apply the coupon to the room price after pricing rules and rate-plan adjustments and before taxes** (taxes are calculated on the discounted amount), and never below zero. **Confirm local tax treatment with an accountant before launch** | A defined order keeps prices predictable; the correct tax base is a legal question per country |
| S136 | **One coupon per booking, no stacking with other coupons.** Whether it combines with rate-plan discounts (for example Non-refundable) is a per-coupon option, **off by default** | Stacked discounts are a common source of unintended price cuts |
| S137 | **Coupons are per hotel** (this dashboard is for one hotel, D76); an owner-level group coupon is a later feature | Matches the single-hotel dashboard |
| S138 | **Codes are case-insensitive, trimmed, unique per hotel, 4 to 24 letters or digits;** generate a suggestion on request | Prevents mistyped duplicates |
| S139 | **Reserve a redemption when checkout starts and release it when the hold ends** (payment failure, expiry, cancellation); count only confirmed and retained uses toward the limit shown in the list | No overselling of limited offers |
| S140 | **First release eligibility rules:** booking window, stay window, minimum spend, specific room types, new guests only (guest matching), minimum advance days, allowed weekdays of arrival; no per-channel rules | Covers what the designs show without building a rules engine |
| S141 | **Rate-limit code attempts on the public endpoint and return one generic message for invalid, expired or ineligible codes** (the reason is shown only to staff) | Stops guessing of codes |
| S142 | **Permissions:** view coupons, manage coupons, export usage as separate capability keys; staff can apply a valid code in a booking without managing coupons | Marketing control is not a front-desk task |

**Decisions needed**

| # | Question |
| --- | --- |
| D88 | **Decided: ok.** Coupon applies after pricing rules and plan adjustments, before taxes, never below zero; one coupon per booking, no stacking (S135-S136; tax treatment confirmed with an accountant before launch) |
| D89 | **Decided: ok.** Coupons are per hotel; codes are case-insensitive and unique per hotel; a redemption is reserved while checkout is held (S137-S139) |
| D90 | **Decided: ok.** First-release eligibility rules, rate limit with one generic public message, separate coupon permissions (S140-S142) |
| D91 | **Decided: later.** Coupons are not in the first release; the plan stays recorded |

## Page 19 — Reports

**Design source:** four Figma PNGs from a section with six tabs (Overview, Reservations, Revenue & Payments, Occupancy & Stay, Accommodation, Custom View): **Reports overview, Reservations report, Revenue & payments report, Occupancy & stay report.** **Accommodation and Custom View were not supplied.** **What exists today:** `reports.tsx` (367 lines) over one endpoint returning three daily series for a date range: **occupancy per day, bookings created per day, and revenue per day per currency** (plus a cancellation figure), drawn with ECharts. There are no filters beyond the date range, no comparison period, no export, no per-source or per-room-type breakdown, no saved views.

**The design's principles are sound and should be kept:** every metric states its own **date basis** (reservations by booking date, occupancy by stay date, revenue by payment date, refunds by processed date) and states, in the page, how it is defined; the reports are **read-only** and **never mutate** anything; exports record the filters, basis, time zone, actor and time; numbers come from the stored booking and payment snapshots.

### Class by report

| Report | Real now | Derivable (new queries) | Not possible without new data |
| --- | --- | --- | --- |
| **Reservations** | Bookings created per day; cancellation figure | Total, confirmed, pending, cancelled or expired counts and rates; average lead time and length of stay; guests booked (adults, children); lifecycle funnel (created, payment started, paid, confirmed, cancelled) from statuses and payments; reservation table; booking-mode mix (room type, individual) | **Source and channel** (Direct, Staff, Partner, Phone, Provider; G17); **instant versus on-request versus internal review** (G19); "provider confirmed" milestone counts need stored provider results; comparison period is a second query |
| **Revenue & Payments** | Payment totals per day per currency | Gross booking value, confirmed revenue, collected, refunded, pending, failed, net collected, collection rate; revenue by room type; refund analysis; payment outcomes; financial-event table; the "waterfall" | **Revenue by source** (G17); **refund reason categories** (G102); **PokPay and Clock reconciliation figures** (partly G98, G105); a single stored definition of "confirmed revenue" (G97); **taxes and fees breakdown** (G74) |
| **Occupancy & Stay** | Occupancy per day | Physical, blocked, sellable and sold room nights; arrivals and departures; length-of-stay distribution; occupancy by room type; future pickup (next 7, 14, 30 days on the books); daily stay-date table; arrival and departure load by weekday | **Blocked versus out-of-service** split (G41, G40; one count for now); occupancy **by exact unit** (the design routes this to the Accommodation report); historical "pickup versus last year" needs stored history (G1) |
| **Overview** | — | Four headline numbers plus four report cards, from the above | Same limits |
| **Accommodation, Custom View** | — | Not supplied | Custom saved views: see S144 |

**Rules in the design that need a decision, not just code**

- **Confirmed revenue = "paid and locally confirmed reservations only", recognized on payment date.** The system's reality: pay-at-hotel bookings are confirmed without an online payment, and Clock hotels have folio payments. A single written definition shared by Overview, Reservations, Payments and Reports is required (G97, S143).
- **Currency.** Hotels can have more than one currency on rate plans; reports must never add different currencies (S145).
- **Time zone.** Every "by day" figure depends on the hotel's time zone; this ties to the open time-zone finding (G72).
- **Staff access.** Financial figures must not be shown to roles without a money permission; the existing capability `reports.view` gates the page today (S146).

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S143 | **Build reports on one shared "metrics" layer with written definitions** (booking date, stay date, payment date, refund date; confirmed, collected, net) reused by the Overview, Reservations, Payments and Reports | The same number must never differ between two screens |
| S144 | **First release: Overview, Reservations, Revenue & Payments and Occupancy & Stay with a date range, comparison period and CSV export;** Accommodation and Custom View (saved views) later | Covers what hotels ask for first; custom views are a separate feature |
| S145 | **Show money per currency; never sum across currencies;** if a hotel has one currency, show one total | Prevents meaningless totals |
| S146 | **Money figures only for roles with the reports and payments permissions;** exports follow the existing export permission and are audited (G21) | Guest and payment data in files needs control |
| S147 | **Compute reports from the live tables first, with a short cache,** and add pre-aggregated daily tables only if queries become slow | Avoids building a data warehouse before it is needed |
| S148 | **Hide any chart or card whose data does not exist yet** (source, instant versus on-request, refund reasons, reconciliation, blocked versus out-of-service) and add it when its source field ships | No empty or invented numbers |
| S149 | **Reuse the existing chart library (ECharts) with the new theme tokens;** one chart style across all reports | One look, existing dependency |

**Decisions needed**

| # | Question |
| --- | --- |
| D92 | **Decided: yes.** Shared metrics layer with written definitions; first-release report set with date range, comparison and CSV export; money per currency (S143-S145) |
| D93 | **Decided: yes.** Money figures only for roles with the permissions; live queries with a short cache; hide what has no data; ECharts with theme tokens (S146-S149) |
| D94 | **Received:** Accommodation, Custom View, Report states. Still awaited: Staff, Settings, Notifications, platform-admin area |

### Page 19a — Accommodation report, Custom view and Report states (design received 2026-10-16)

**Accommodation performance report.** Room-type ranking by RevPAR, occupancy, ADR and RevPAR comparison, revenue contribution and **booking conversion** (search-to-book), blocked and out-of-service capacity impact, demand and **booking-mode mix** (instant versus on request), **performance score** (a composite index), and an **exact room-unit drill-down** with source of truth (Clock PMS or Local), sold nights, occupancy, revenue, blocked nights, assignment, and data status; insights cards; filters by room type, unit, booking source and mode.

| Element | Class | Notes |
| --- | --- | --- |
| Per room type: sellable and sold nights, occupancy, ADR (revenue / sold nights), RevPAR (revenue / sellable nights), revenue | Derivable | Same metrics layer (S143); definitions are shown in the page itself, which is good |
| Ranking and comparison bars | Derivable | |
| Per unit: sold nights, occupancy, revenue, blocked nights | Derivable | Only when rooms are assigned to bookings (individual rooms or Clock stay data); room-type-only hotels have no unit data |
| Source of truth per unit (Clock PMS or Local) | Derivable | One source per hotel (D35), so the column carries no information; drop it |
| **Booking conversion (search to booking)** | **Gap** | No search or visit events are stored; cannot be calculated (G139) |
| **Performance score ("Portfolio 81 / 100")** and "performance insights" | **Invented** | A weighted index with no agreed formula; omit unless the formula is defined and justified (S151) |
| **Blocked vs out-of-service split** and reasons (maintenance, owner block) | Partial | Blocks get a reason (D27, G41); out-of-service comes with Milestone 25 |
| Instant vs on-request mix | Gap | Depends on G19 |
| Provider evidence freshness (Clock evidence fresh), unmapped units | Partial | Clock hotels only |

**Custom view (report builder).** Saved views with owner and visibility (private, team, role default), base report and basis, an **AND/OR filter-rule builder**, grouping and subtotals, sorting, selected columns with required and sensitive flags, a 100-row preview, **export configuration** (format, row scope, encoding, delimiter, include filters, metric definitions, source freshness, metadata, sensitive fields), export readiness, recent exports (completed or failed).

| Element | Class | Notes |
| --- | --- | --- |
| Saved view as a stored configuration (not data) | Gap | New table (G140) |
| Advanced AND/OR filter groups with arbitrary fields | Gap | A general query builder over every field is a large feature with security risk (see S150) |
| Grouping, subtotals, sorting, column picker | Gap | Reasonable on top of the metrics layer for a fixed list of fields |
| Preview, export (CSV, PDF), recent exports, export audit | Gap | Export is one feature (G136); PDF needs a renderer |
| Sensitive fields behind a separate permission; export re-checks permission at run time | Gap | Matches the existing export permission idea (S146) |

**Report states.** The same reference pattern as the other sections (no data, filtered empty, **incomplete model**, **source data degraded**, processing failure, read-only). Notable rules to adopt: external or provider-dependent metrics show **"Unknown"** instead of stale numbers when the source is stale; a failed export never leaves a partial file; and the incomplete-model state (for example units unmapped so occupancy cannot be calculated) blocks only the affected report. It follows S28 and S97.

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S150 | **Custom view first release = saved filters on the four built-in reports** (period, comparison, room type, source, status), a chosen column set, grouping by a fixed list, and CSV export. **Do not build the free AND/OR rule builder in the first release** | A fully general builder multiplies testing and permission risk; saved views of known reports deliver most of the value |
| S151 | **Leave out the "performance score" and generated "insights" text;** keep ranking by RevPAR, occupancy and ADR | A composite index nobody can audit is not a metric |
| S152 | **Booking conversion needs search and checkout event capture; plan it as a separate analytics feature if wanted** | Cannot be derived from bookings |
| S153 | **Unit-level drill-down only for hotels that assign rooms to bookings** (individual-room or Clock stays with room data); other hotels see room-type level only | Do not show unit data that does not exist |
| S154 | **Saved views are private to their owner or shared with the hotel team; role defaults are set by an owner or admin** | Matches the design's visibility options without extra roles |
| S155 | **CSV first; PDF later as a branded summary using a maintained renderer** | CSV covers accountants; PDF is presentation |

**Decisions needed**

| # | Question |
| --- | --- |
| D95 | **Decided: yes.** Custom view first release is saved filters on the built-in reports (no free rule builder); no performance score or generated insights; booking conversion planned separately (S150-S152) |
| D96 | **Decided: yes.** Unit drill-down only for hotels with room data; private or team views; CSV first, PDF later (S153-S155) |
| D97 | **Received:** Integrations (for the admin dashboard, see below). Still awaited: Staff, Settings, Notifications, platform-admin area (tenants, users, plans) |

## Page 20 — Integrations (admin dashboard, not hotel staff)

**Design source:** nine Figma PNGs: **Integrations overview, Clock connection, Provider mapping, Sync operations, Provider request logs, Booking diagnostic, Sync job detail, Manual review queue, Integration states.** **Owner decision (2026-10-16): this section belongs to the admin dashboard, not to the hotel staff dashboard.** It is therefore built in the platform-admin area (`/platform`, today `platform/tenants`, `platform/audit`, with provider health and manual-review resolution already there), scoped to one tenant and hotel at a time, and it follows D23 (technical evidence is for operators, not hotel staff).

**What hotel owners and admins keep in the hotel dashboard:** the simple parts already planned: Settings > Integrations (connect, test connection, rotate credentials), the Accommodation mapping status (Page 12), "this booking needs review" with a Retry action (Page 3 and 9), and read-only provider health chips. Everything below is the operator view.

**What exists today:** `integration_connections` (encrypted credentials, status, last test), `property_integration_connections`, `clock_catalog_mappings` (entity type, local and external ids, sync status PROPOSED, CONFIRMED, REJECTED), `integration_operations` (idempotency key, aggregate id, external reference, request hash, status, attempts, result), `provider_events`, `manual_review_items` (7 categories, Open or Resolved, resolved in platform admin by one action), a Clock webhook health check, a circuit breaker, a platform "provider health" endpoint and a scheduled Clock consistency and payment reconciliation worker.

| Screen | What exists | What is new |
| --- | --- | --- |
| **Overview** (connected 2/2, Clock sync health 98.7%, webhook delivery 99.4%, open operations, PMS and PokPay cards, mapping coverage) | Connection status, webhook health, provider events, operations, mapping rows | Percentages need defined windows and queries; "Open diagnostics", "Run health check", "Sync now" need staff-triggered, idempotent actions (G143) |
| **Clock connection** (name, account, masked credentials, environment, sync directions, interval, retry mode, unknown-outcome rule; Test connection, Save, Disconnect, Sync now) | Connection test, encrypted credentials, disconnect (delete) | **Per-direction sync settings (availability, rates, reservations), interval and retry mode are system behavior today, not per-hotel settings** (S156); the environment is deployment configuration (S110) |
| **Mapping** (hotel, room types, exact units, rate plans, with status Mapped / Review / stale, validate, import from Clock) | `clock_catalog_mappings` with confirm and reject, catalog sync | "Validate mappings" and a **stale** state; coverage tiles; this is the same data as Accommodation setup warnings (S78) |
| **Sync Ops** (queued, processing, failed or review, completed today; job table with attempts and idempotency; Pause queue, Run sync, Run remote check) | `integration_operations` rows with attempts and status; BullMQ queues | Job listing view; **Pause queue** and manual **Run sync** are new controls with real risk (S157); "run remote check" is the lookup-before-retry already in the adapter, exposed as a button (G98) |
| **Sync job detail** (attempt timeline, request evidence, retry gate) | Attempts counter and last result | Per-attempt records and a timeline (G144) |
| **Manual review queue** (cases with SLA, assignee, evidence completeness, claim, resolve) | Open and Resolved items | **Assignee, SLA, claim, evidence checklist and a decision record** (G38, extends the earlier provider-review plan) |
| **Request logs** (request id, correlation id, endpoint, method, latency, HTTP status, redacted headers and body, P95 latency, evidence retention 30 days, export evidence) | Server logs with request ids exist, but **provider HTTP calls are not stored as queryable records** | A request-log store with redaction and retention is new (G145); the design's redaction rules are right |
| **Booking diagnostic** (payment, local booking, Clock reservation, folio accounting states; four ordered checks; root cause and safe resolution) | The facts exist in separate places (payment, booking, operation, folio) | A read-only assembled view per booking (G146) |
| **States** (disconnected, no mappings, invalid credentials, webhook trust failed, permission restricted, provider write unknown) | Standard states | Follows S28, S97 |

### Rules in the design that agree with the system and should be kept

Clock is the operational source of truth for availability, inventory, rates and reservations; the payment provider is the payment truth; **a redirect return is never authoritative**; retries are idempotent and **blocked until remote existence is checked**; credentials and raw payloads never reach the browser; local admin mirrors provider state and **never fabricates provider success**.

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S156 | **Treat sync direction, interval, retry mode and unknown-outcome handling as read-only descriptions of how the integration works,** not editable settings; only connection identity and credentials are editable | Changing directions or retry rules per hotel is risky and is not supported by the adapter today |
| S157 | **First release of Sync Ops is read-only plus two safe actions: "Run remote check" and "Retry" for a single job (idempotent). No global Pause queue and no free "Run sync"** | Pausing production queues from a UI needs a deliberate design and affects every hotel |
| S158 | **Request logs: store only redacted request and response summaries (method, endpoint, status, latency, ids, error class), 30-day retention, with a redaction library and tests;** never store full guest data or secrets | Matches the design's own protection rules |
| S159 | **One manual-review queue serving both the operator (all tenants) and the hotel's simple "needs review" card,** with assignee and status first and SLA later | Avoids two review systems (S23) |
| S160 | **Booking diagnostic is a read-only view assembled from existing facts, linked from the booking and from a review case** | Gives support what they need without a new data model |
| S161 | **Integrations lives in the platform-admin area, tenant-scoped, behind a platform-admin check,** with an owner-visible read-only status in Settings | Matches the owner's decision and D23 |

**Decisions needed**

| # | Question |
| --- | --- |
| D98 | **Decided: ok.** Sync behavior is shown read-only; Sync Ops first release is read-only plus Run remote check and single-job Retry (S156-S157) |
| D99 | **Decided: ok.** Redacted 30-day request log; one review queue; read-only booking diagnostic; Integrations in the platform-admin area (S158-S161) |
| D100 | **Decided (owner): yes.** The owner's all-hotels views live in the admin dashboard together with Integrations. Designs for the platform-admin area, tenant list and users are still awaited; Settings (overview, General, Booking rules) received |

## Page 21 — Settings

**Design source:** three Figma PNGs: **Settings overview** (a control center of 13 areas), **General settings** and **Booking rules**. The overview lists the remaining areas (Check-in & Check-out, Payments Summary, Staff & Access, Staff Users, Frontend & Branding, Managed Pages, Notifications & Emails, Provider, Diagnostics & Maintenance, Billing Account, Dangerous Reset) which have **not** been supplied, except where an earlier section already covers them (Emails, Payments and Integrations). **What exists today:** `settings.tsx` (897 lines) with eight areas (General, Booking rules, Payments, Branding, Emails, Managed Pages, Billing account, plus the settings hub from Milestone 13), reading and saving property fields: name, address, time zone, public website origin, payment method switches (Stripe, PokPay, pay at hotel), minimum and maximum stay, check-in and check-out time, advance booking days, **booking mode (room type, individual, mixed)**, free-cancellation days before arrival, logo, phone, support email, **same-day booking and cutoff time**, review links, and connection to the WordPress site.

### 21a — Settings overview

| Design element | Class | Notes |
| --- | --- | --- |
| Area directory (13 cards with health, scope Property, System or Account, last reviewed) | Partial | Hub exists; health per area is derived (S162) |
| Header chips and environment select ("Production") | Rule | Environment is deployment configuration, shown read-only (S110) |
| Configuration health: overall 92% (12 of 13 areas), booking readiness, change review, action required | Derivable | From the shared readiness engine (S43, G51) |
| **End-to-end booking readiness** chain (property identity, booking rules, inventory, online payment, provider fulfilment, guest confirmation) | Derivable | A valuable one-glance check built from existing facts |
| Recent configuration activity, "scope and access" card | Partial | Audit exists; settings change history needs before/after summaries (G149) |
| **Change control**: direct save for low-risk copy, **validation required** for booking, payment, email, page and provider settings, credential-protected secrets, destructive confirmation | Gap | A validation-before-save model (G150, S163) |
| Tax ID / VAT missing as an "action required" billing item | Derivable | Billing identity fields are Milestone 15 (Billing account) |
| Dangerous Reset | **Needs a decision** | The product has no hotel reset or data wipe (D101) |

### 21b — General settings

| Design element | Class | Notes |
| --- | --- | --- |
| Internal property name, **public hotel name** | Partial | One name exists; a separate public name is new (G151) |
| Property code (EBR-AL-001), operational status (Active) | Partial | Slug exists; code and status are new (G151) |
| Country, city, postal code, street address, address line 2, public address format, **map location (pin)** | Partial | One address text field exists today; structured address, country and map coordinates are new (G151) |
| Timezone, currency, locale, date format, time format, week start, phone country code | Partial | **Time zone** exists (and has the Europe/Tirana finding, G72); **currency is set per rate plan, not per property**; locale and formats are new (G152) |
| Reservations email, public contact email, hotel phone, operations contact, **emergency label**, public visibility | Partial | Phone and support email exist; the rest are new (G151) |
| Booking support label, public website URL, default display name | Partial | Public website origin exists |
| Validation checklist, change impact, audit evidence, unsaved-changes bar, Validate button | Gap | G150 |
| Rule: "currency change requires payment and pricing readiness; existing bookings keep their currency" | Rule | Right; the product should block a currency change once bookings or rate plans exist (S164) |

### 21c — Booking rules

| Design element | Class | Notes |
| --- | --- | --- |
| Public booking on or off, guest checkout, customer account link, public room selection, customer self-cancellation | Partial | Booking mode exists; **no master public-booking switch**; **no customer accounts or customer portal exist** (so "account link" and "customer cannot cancel in the portal" do not apply); self-cancellation exists through a cancellation link with a free-cancellation window (G153) |
| Booking modes: instant, **on request**, internal review; default public mode; per-room-type override | Gap | On-request is a planned feature (G19, D11); today "booking mode" means room type or individual rooms (a different concept); the two must not share a name (S165) |
| Inventory hold: **hold duration (10 minutes)**, hold scope (exact unit), unit assignment (automatic), conflict protection, release expired holds, source of truth per hotel | Partial | Holds and automatic expiry exist; **duration is a system value today, not a hotel setting** (S166); conflict protection and release are system behavior |
| Eligibility and limits: minimum stay, maximum stay, booking window (365 days), same-day booking, **rooms per booking**, occupancy validation | Partial | Minimum and maximum stay, advance days and same-day with cutoff exist; **multiple rooms per booking exists in the API** (G14) but has no per-hotel limit setting |
| Cancellation and booking changes: customer self-cancellation, customer self-modification, staff cancellation (permission) | Partial | Self-cancellation window exists; self-modification does not exist; staff cancellation exists with a permission |
| Critical invariants, related settings ownership, **effective booking lifecycle outcomes table** (instant checkout started, paid, failed or expired; on-request submitted, approved, paid) | Rule | Good documentation of how the system behaves; keep as read-only explanation (S167) |
| Rules version (v12), validation, before/after, audit | Gap | Versioning of settings (G150) |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S162 | **Settings overview shows real health per area** (configured, needs attention, not set) and the end-to-end booking readiness chain, computed from the same readiness engine as Accommodation and Pricing | One source of truth for "is this hotel ready to take bookings" |
| S163 | **Keep the three change levels:** direct save (low risk copy), **validate then save** (booking rules, payments, email, pages, provider), and credential-protected. **Skip a separate "Validate" button on every page in the first release;** validation runs on Save and shows the result | Same safety with fewer steps; the checklist stays |
| S164 | **Block a currency change once rate plans or bookings exist;** show currency as read-only afterwards | Prevents inconsistent pricing and payments |
| S165 | **Rename the two concepts:** "Inventory mode" for room type or individual rooms (today's booking mode) and "Booking type" for instant, on request (planned) and staff-only | One word, one meaning |
| S166 | **Keep hold duration as a system default (not editable per hotel) until there is a reason;** show it read-only in Booking rules | Changing hold time affects stock and payment timing; the payment expiry job assumes one value |
| S167 | **Show the lifecycle outcomes table as read-only help,** generated from the real states, and hide the invariants card behind an "How this works" disclosure | Useful for staff trust, not clutter |
| S168 | **Settings areas the hotel owner needs now:** General, Booking rules, Check-in and Check-out, Payments, Branding, Emails, Managed pages, Staff and access. **Provider and Diagnostics move to the admin dashboard** (D23, D100); **Billing account** waits for Milestone 15 | Matches the earlier placement decisions |
| S169 | **Do not build "Dangerous Reset" in the first release;** if ever needed, make it a platform-admin action with a separate permission, typed confirmation and a reason | Irreversible; no current requirement |
| S170 | **Settings save as before/after audit entries with the actor;** versions (v12) only for booking rules and rate-related settings | Auditable without versioning everything |

**Decisions needed**

| # | Question |
| --- | --- |
| D101 | **Decided: yes.** Dangerous Reset is left out of the first release (S169) |
| D102 | **Decided (owner: 101-104 yes).** Real health and booking readiness chain; validate on save; currency locked once in use (S162-S164) |
| D103 | **Decided (owner: 101-104 yes).** Rename inventory mode vs booking type; hold duration read-only; lifecycle table as help (S165-S167) |
| D104 | **Decided (owner: 101-104 yes).** Area placement (Provider and Diagnostics to the admin dashboard, Billing waits for Milestone 15); before/after audit with versions only where needed (S168, S170) |
| D105 | **Received:** Check-in & Check-out, Payments summary, Staff & Access. Still awaited: Staff Users, Frontend & Branding, Managed Pages, Notifications, platform-admin area |

### Page 21a — Settings: Check-in & Check-out, Payments summary, Staff & Access (design received 2026-10-16)

**Check-in & check-out.** Standard check-in and check-out times with a property time zone and guest-facing labels; expected arrival time, late-arrival notice, departure reminder; **early check-in requests** and **late check-out requests** (availability, manual staff approval, "approval does not change reservation dates or create a charge"); guest instruction copy; a guest-journey timeline; and an outcomes table.

| Element | Class | Notes |
| --- | --- | --- |
| Check-in and check-out time | Real | `check_in_time` and `check_out_time` exist on the property |
| Guest-facing labels and instruction copy ("Check-in from 14:00") | Gap | Derive from the times; custom copy is optional (S171) |
| Expected arrival time, late-arrival notice, departure reminder | Gap | Arrival time is G31 / S22; reminders relate to Milestone 22 emails |
| Early check-in and late check-out requests with approval | Gap | This is the **guest requests** feature already planned (Page 1c, D7, S23); the outcomes table (submitted, approved, declined, dates unchanged, no charge) describes it. The setting only toggles which request types are accepted |
| "No automatic extension; approval never changes dates or charges" | Rule | Matches D7 (version one records the decision without charging) |

**Payments summary.** A read-only summary of public payment policy, methods (PokPay primary, Stripe standby, Pay at Hotel and Pay Later disabled), verification rules, refund policy, Clock deposit accounting, the verified payment lifecycle and an exception matrix; links to Payments and Provider settings.

| Element | Class | Notes |
| --- | --- | --- |
| Public payment policy "online payment required" and "collection timing" | Partial | Each payment method has a per-hotel switch; the **overall policy and collection timing** (full amount, deposit, pay later) are not settings; rate-plan payment terms are planned (D57) |
| **Pay at Hotel disabled, Pay Later not offered** | **Conflict** | **Pay at hotel is a supported method today** (`pay_at_hotel_enabled`, used by the walk-in and bookings). The design disables it by default for public checkout |
| Method cards (PokPay, Stripe standby) with Open connection | Real | Stripe and PokPay switches and connections exist |
| Authoritative verification, refund policy, Clock deposit accounting, lifecycle, exception matrix | Rule | **Matches the payment design already planned (Page 15)**; keep as read-only help generated from real states |
| "Refund scope: Full refund only; partial refunds are not offered in the customer flow" | Rule | Staff can refund partially (Page 15 and Milestone 13 task 7); the customer cannot. Consistent with today |

**Staff & Access.** A role registry (Admin staff, Booking agent, Finance staff, Read-only staff; system roles that cannot be deleted; custom roles), role assignments, a portal and session policy, **how effective access is calculated** (baseline role, explicit allow, explicit deny, expiry, account status; **deny wins**), an **18-key permission matrix** grouped by domain, **user-level override governance** (reason, approver, temporary with expiry), role-change impact preview and activity.

| Element | Class | Notes |
| --- | --- | --- |
| Role registry and templates | Partial | `property_role_templates` exist per property (Property Manager, Front Desk, Finance seeded; custom templates can be created) |
| **18 permission keys** in five domains (view_bookings, manage_bookings, update_booking_status, view_guests, manage_hotels, manage_room_types, manage_pricing, manage_availability, view_payments, manage_payments, view_reports, export_reports, view_provider_operations, manage_provider_connections, retry_provider_operations, manage_staff, manage_roles, view_activity_logs) | **Does not match**: the product has **11** capability keys (`bookings.manage`, `calendar.view`, `guests.manage`, `payments.refund`, `reports.view`, `photos.manage`, `rates.manage`, `accommodations.manage`, `settings.manage`, `staff.invite`, `staff.manage_permissions`) | A decision is needed on the permission model (D106, S172) |
| Per-user overrides (allow and deny), **temporary overrides with expiry and reason**, deny wins | Partial | Per-user allow or deny overrides exist; **expiry, reason and approver do not** (G156) |
| Account status (suspended, deactivated) evaluated last | Partial | Memberships exist; suspend and revoke sessions need checking (G157) |
| Custom roles | Partial | Templates can be created per property; the design says "no custom roles yet" and offers Create custom role |
| Role-change impact preview, session behavior, rollback evidence | Gap | G158 |
| "WordPress admin blocked for staff roles, portal only" | Rule | The staff dashboard is the only staff surface; matches |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S171 | **Check-in and check-out: edit the two times and the time zone display; build early check-in and late check-out as request types of the guest-requests feature (accepted or off per hotel);** labels are generated from the times, with an optional custom instruction line | Avoids a second request system |
| S172 | **Permissions: keep the existing 11 keys now, extend by splitting them into the design's read and write pairs where the product has the screens** (for example reports.view plus reports.export, payments.view plus payments.manage, provider.view and retry for admins). **Do not adopt all 18 keys up front** | Every permission key must be enforced by a real endpoint and screen; unused keys give a false sense of control |
| S173 | **Pay at hotel stays a supported method; the per-hotel policy is "which methods are offered publicly"** with online-required as the default for new hotels. The owner decides per hotel | Many hotels, including small ones, accept pay at hotel |
| S174 | **Payments summary in Settings is read-only,** generated from the real settings and linking to Payments and Integrations; collection timing (full, deposit) arrives with rate-plan payment terms (D57) | One place to change things |
| S175 | **Staff access: keep deny-wins and baseline-plus-overrides; add reason and optional expiry to overrides;** no separate approver step in the first release | Matches how the model already works with small additions |
| S176 | **Show a role-change impact preview (who is affected, which permissions are added or removed) before saving a role,** and revoke or refresh active sessions on suspension | Standard access-control safety |

**Decisions needed**

| # | Question |
| --- | --- |
| D106 | **Decided: yes (owner: 106 and 108 yes).** Keep the existing 11 permission keys and extend gradually in read and write pairs where screens exist (S172) |
| D107 | **Decided: ok.** Pay at hotel stays a supported per-hotel method; the Payments summary in Settings is read-only (S173-S174) |
| D108 | **Decided: yes.** Check-in and check-out requests are request types of the guest-requests feature; overrides with reason and optional expiry; role-change impact preview (S171, S175-S176) |
| D109 | **Received:** Staff Users, Frontend & Branding, Managed Pages, Notifications & Emails, Provider settings, Diagnostics & Maintenance, Billing Account. Still awaited: Notifications (bell and inbox), platform-admin area |

## Page 22 — Staff Users and the remaining Settings areas

**Design source:** seven Figma PNGs: **Staff Users, Frontend & Branding, Managed Pages, Notifications & Emails, Provider settings, Diagnostics & Maintenance, Billing Account.** (The last four also fix where Provider and Diagnostics belong, D104.)

### 22a — Staff Users

**What exists:** `staff.tsx` (316 lines) and the staff endpoints (invitations with property assignments and role templates, memberships, per-property staff list, capability overrides, role templates). The design: a staff table (member, role, scope, overrides, security state, last access, status), access summary, role distribution, **security posture** (new-device review, revoked sessions), pending invitation with **Resend**, **access exceptions requiring review**, the invitation lifecycle (prepared, sent, accepted, activated, first sign-in), account status behavior (Active, Invited, Suspended, Deactivated; suspend revokes sessions, **never delete**).

| Element | Class | Notes |
| --- | --- | --- |
| Staff list, roles, scope, status (Active, Invited, Suspended) | Partial | Invitations and memberships exist; suspend, deactivate and a status field per staff member need verification (G157) |
| Staff IDs (STF-001), last access, "secure" state | Gap | No staff reference, no last sign-in record, no device tracking (G162) |
| **New-device review, revoked sessions, security posture** | Gap | Not tracked; sessions are in Redis (G162, S177) |
| Overrides with reason, approver, expiry; "access exceptions requiring review" | Partial | G156 |
| Resend invitation, invitation expiry | Partial | Invitations are one-time tokens (7 days) in Redis; resend needs a new token and a record of the pending invitation (G163) |
| Delete is not the normal action: suspend or deactivate, history retained | Rule | Matches the data model (rows retained) |
| Export, Activity logs | Partial | Export gated and audited (G21) |

### 22b — Frontend & Branding

**What exists:** logo URL, Settings > Branding (email branding), review links. The design: brand assets (primary and inverse logo, compact mark, favicon with size and format validation), a **public color system** (primary, accent, background, text, cards) with contrast checks, typography (heading and body fonts), button and component shape, public density, guest-facing labels ("Check availability", "Book now"), a desktop and mobile **preview**, **published versions with rollback**, ownership boundaries.

| Element | Class | Notes |
| --- | --- | --- |
| Logos, favicon, brand colors, fonts, radius, labels applied to the **public booking pages** | Gap | The public booking UI is rendered by the **WordPress plugin** (Elementor and plugin CSS), not by this app; branding must be carried to the plugin through a published theme setting (G164) |
| Contrast validation (AA) and publish gate, versions, rollback | Gap | G164 |
| **Dashboard theme (the owner's selectable theme)** | Separate | This is G22 (decided): the staff dashboard theme; do not mix with the public booking branding |

### 22c — Managed Pages

**What exists:** the WordPress plugin has `ManagedPages.php` (it creates and tracks the booking pages) and the web app has a "Managed Pages" settings area (connect WordPress). The design: a registry of seven required pages (rooms listing, booking start, accommodation selection, checkout, booking confirmation, staff login, staff portal) with route, template, status and health; a **repair** that is idempotent and never deletes or overwrites valid content; a **decision matrix** (missing, draft, trashed, invalid template, invalid shortcode, duplicate route, healthy); supporting policy pages (terms, privacy, payment, cancellation); recent checks and repairs.

| Element | Class | Notes |
| --- | --- | --- |
| Registry, health check, repair | Partial | The plugin creates pages and the app can show the connection; a reported registry (page id, route, template, binding validity) must come from the plugin through the API (G165) |
| **Staff login and staff portal as WordPress pages** | **Conflict** | The staff dashboard is this Next.js app, not a WordPress page; confirm whether "staff portal pages" are still planned (D112) |
| Policy pages (terms, privacy, payment, cancellation) | Partial | Settings holds legal links; assignment of policy pages belongs here |

### 22d — Notifications & emails, Provider settings, Diagnostics & maintenance

| Screen | Content | Class and placement |
| --- | --- | --- |
| **Notifications & emails** | Sender, guest email events (booking confirmation, payment receipt, cancellation and refund, default recipient, delivery failure), operational alert routing, retry, templates and localization | **Duplicates the Emails section (Page 17).** Settings keeps one card linking to Emails; no second implementation (S178) |
| **Provider settings** | Authority per domain: operational source of truth (Clock), payment source (PokPay), inventory and rates direction, paid-booking fulfilment, sync cadence, credentials, change control | **Admin dashboard (D104).** Hotel owners see a read-only summary; "source of truth" is one per hotel (D35) |
| **Diagnostics & maintenance** | Health checks (schema, managed pages, PokPay callback, Clock, email), maintenance tools (rebuild links, create snapshot), danger zone | **Admin dashboard** (platform area); the danger zone is dropped (D101) |

### 22e — Billing Account (Milestone 15)

The design shows plan "Operations Pro" at €149 a month, next invoice, payment method (card), billing details (legal name, email, **Tax / VAT ID**, address), and invoice history with downloads. **None of it exists** (billing is Milestone 15) and the plan name, price and feature list are demonstrations. Under the owner's 2026-10-14 decisions this screen must show: the plan (Free with its 2-week limit, or a paid tier), what is **locked** after the free period, usage against limits (properties, staff seats), billing details and invoices once Stripe Billing is built. It is recorded for Milestone 15, not built here.

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S177 | **Staff security: record last sign-in time and device summary, show it in the list, and revoke sessions on suspension;** skip "new-device review" workflows until asked | Real, small, useful; avoids inventing a security product |
| S178 | **Do not duplicate: Settings has one "Notifications & emails" card that opens Emails;** the Provider and Diagnostics areas open the admin dashboard for platform admins and show a read-only summary to owners | One implementation per feature |
| S179 | **Public branding is a small published theme** (logo, favicon, primary and accent color, button radius, two labels) delivered to the WordPress plugin through the public API, with a contrast check and a draft-then-publish step; fonts, density and component layout stay fixed in the first release | The public pages are rendered by the plugin; a constrained theme is achievable and safe |
| S180 | **Managed pages: the plugin reports the registry (page, route, template, health) and exposes an idempotent repair;** the dashboard shows it and triggers the repair | Keeps the logic where the pages live |
| S181 | **Staff invitations: show pending invitations with expiry and a Resend (new token, old one invalid);** store an invitation record for the list | Today a token lives only in Redis |
| S182 | **Billing Account is designed against Milestone 15,** with the free-period lock, limits usage and Stripe-hosted card and invoice management (no card data in our system) | Matches the owner's plan decisions |

**Decisions needed**

| # | Question |
| --- | --- |
| D110 | **Decided: yes.** Staff security basics (last sign-in, device summary, sessions revoked on suspension) and pending invitations with Resend (S177, S181) |
| D111 | **Decided: yes.** No duplicate Settings areas; managed pages reported and repaired through the plugin (S178, S180) |
| D112 | **Decided (owner): staff sign in only through this dashboard app.** There are no WordPress staff login or staff portal pages; the Managed Pages registry therefore lists only the public booking pages and policy pages |
| D113 | **Decided: yes.** Public branding is a small published theme delivered to the WordPress plugin (S179) |
| D114 | **Decided: yes.** Billing Account is designed against Milestone 15 with the free-period lock and Stripe-hosted card and invoice management (S182) |
| D115 | **Owner: no Notifications design exists; a single Notifications page is planned (Page 23).** The owner's all-hotels views and the platform-admin area will be planned after the Staff pages |

### Page 22f — Staff & Access (roles and permission matrix) (design received 2026-10-16)

The design is the **same Staff & Access page already planned in Page 21a** (role registry with four protected system roles Admin staff, Booking agent, Finance staff, Read-only staff; role assignments; portal and session policy; how effective access is calculated with deny-wins; an 18-key permission matrix; user-level override governance; role-change impact preview; activity). No new features beyond Page 21a. Decisions already made apply: keep the existing 11 permission keys and extend gradually (D106), overrides with reason and optional expiry and a role-change impact preview (D108). Because the design's **four protected roles** differ from the product's **three seeded templates** (Property Manager, Front Desk, Finance), the role names must be aligned (D116, S183).

### Page 22g — Invite staff member (design received 2026-10-16)

A four-step flow (Identity, Baseline role, Access review, Invitation): full name, work email, **internal staff ID (generated, STF-008)**, **job title**, **language**; one **baseline role** chosen from role cards with an **access preview** (granted and write permissions); a **portal and session policy** card (portal access enabled, WordPress administration blocked, **session timeout 8 hours**, **invitation expiry 7 days**, first sign-in recorded); a validation checklist (identity complete, email not already staff, role selected, portal scope resolved, no conflicting active invite); **Send invitation**.

| Element | Class | Notes |
| --- | --- | --- |
| Work email, role, hotel scope, send a single-use link | Real | `POST tenants/:tenantId/staff-invitations` with property assignments and role template; link expires after 7 days (matches the design) |
| Full name | Partial | Not captured at invitation; the person sets credentials when activating (G167) |
| Staff ID, job title, language | Gap | Not stored (G162, G167) |
| Role cards with access preview | Partial | Role templates and their capabilities exist; a preview of "what this role can do" is derivable |
| "Email is not already staff", conflicting active invite | Partial | An existing user is handled through the accept-existing-account path; the conflicting-invite check needs the pending-invitation record (G163) |
| Session timeout 8 hours | Needs check | Confirm the real session lifetime; show the real value (G168) |
| "WordPress administration blocked" | Rule | Matches D112: staff only use this app |
| Seat cap | Real | Invitation is blocked at the plan's seat limit, and a notification is recorded (owner counts as a seat) |

### Page 23 — Notifications (first plan, in-house; **superseded by the designs below**)

**Brief (owner, 2026-10-16):** one page that shows **all** notifications, separated into groups, where clicking a notification takes the user to the relevant place.

**What exists today:** the `notifications` table (type, payload, read time, created time, per property), a header bell with a popover (latest 10, unread count), and an inbox page (`section=notifications`, paged 20). Recorded types today are **Booking created, Booking needs attention, Payment refunded and Staff seat cap reached**. Notifications carry no link; the popover has "View all".

| Element | Class | Notes |
| --- | --- | --- |
| Bell with unread count and a short list | Real | Exists; restyled with the new components |
| One full page listing every notification for the hotel | Real | Inbox exists; this is the page, redesigned |
| **Groups** (for example Bookings, Payments, Guest requests and approvals, Availability and sync, Staff and account, System) with a count each | Derivable | Group is derived from the notification type (S184) |
| **Filters and states:** All, Unread, Needs action; search; date range; mark read, mark all read | Partial | Read state exists; "needs action" requires a flag on the notification (G169) |
| **Click goes to the right place** (booking, payment, guest request, calendar day, staff page, settings area) | **Gap** | Notifications store a type and payload but **no destination**; each type needs a defined target built from its payload (booking id, payment id, property id) (G170) |
| More notification types (payment failed or unknown, refund needs review, email delivery failed, provider needs review, guest request received, cancellation or amendment requested, sync stale, low availability, plan limits, new staff accepted) | Gap | Each type is a new event raised by its feature (G171); the page must not list types nothing emits |
| Per-user preferences (which groups, in-app or email) | Partial | Topic and recipient settings exist per hotel for emails; per-user in-app preferences do not (G172) |
| Realtime updates | Gap | Polling is enough at first (S185) |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S183 | **Align role names:** use the design's four (Admin staff, Booking agent, Finance staff, Read-only staff) as the **seeded templates**, mapping today's Property Manager, Front Desk and Finance onto them (Property Manager = Admin staff, Front Desk = Booking agent, Finance = Finance staff), plus a new Read-only template | One vocabulary across design and product; existing assignments migrate by name |
| S184 | **Notifications page structure:** header with counts, a group list on the left (Needs action, Bookings, Payments, Requests and approvals, Availability and sync, Staff and system), the list in the middle with unread dots and time, and **every row is a link** to its place; filters for unread and date; mark read on open | Matches common inbox patterns; each row has one clear destination |
| S185 | **Link targets are computed from the payload and permission-checked:** a staff member without access to a destination sees the notification without a link (and is not told details they cannot see) | Notifications must not leak data |
| S186 | **Only list event types that exist; each feature adds its own types as it ships** (guest requests, review cases, failed emails, sync problems) with a defined group and destination | No empty categories; one place to register new types |
| S187 | **Needs-action notifications stay in "Needs action" until the underlying item is resolved,** not just read | A read notification is not a resolved problem |
| S188 | **Invite staff: collect name, email, job title, language, role and hotel; generate the staff ID;** skip first-sign-in and device verification steps beyond recording the time | Practical and small |

**Decisions needed**

| # | Question |
| --- | --- |
| D116 | **Decided: yes.** Four role names as seeded templates: Admin staff, Booking agent, Finance staff, Read-only staff (S183) |
| D117 | **Decided: yes.** Notifications page structure, permission-checked links, only existing types, needs-action stays until resolved (S184-S187) |
| D118 | **Decided: yes.** Invite staff form fields (S188) |
| D121 | **Open (next, planned in-house):** the owner's all-hotels views and the platform-admin area |

### Page 22h — Staff user detail (design received 2026-10-16)

For one staff member (Elena Leka, Finance staff): identity (full name, email, job title, hotel scope, baseline role, account created and by whom), **security** (last sign-in, location, active sessions, password state, failed attempts in 30 days), tiles (8 granted and 10 denied permissions, 2 active sessions, 26 audit events), the **effective permission matrix** (baseline, override, effective, source role or user), user-level exceptions with reason and expiry, recent activity (sign-ins, exports, override approved, session revoked, password changed), and status controls (Active, Suspended, Deactivated) with Suspend access and Edit staff user.

| Element | Class | Notes |
| --- | --- | --- |
| Identity, role, hotel, account created by | Partial | Membership and role template exist; job title, staff ID, created-by need G162, G167 |
| **Effective permission matrix with the source of each grant** | Derivable | The capability resolver already combines the role template and overrides; showing baseline, override and effective per key is a read of that logic. With 11 keys today, 11 rows (D106) |
| Override list with reason, approver, expiry, Review and Revoke | Partial | Overrides exist; reason, approver, expiry are G156 |
| Last sign-in, location, active sessions, password state, failed attempts | **Gap** | Not recorded (G162, G173). Location is not needed and should not be collected (S189) |
| Activity (sign-ins, exports, session revoked, password changed) | Partial | Audit log exists for some events; sign-in and password events are not recorded per user (G173) |
| Suspend and deactivate with session revocation, history kept | Partial | G157 |
| Edit staff user | Real | Role and assignment changes exist |

### Page 22i — Roles list (design received 2026-10-16)

Registry of four protected system roles with operational scope, permission count (for example 18/18, 6/18), members and type; role distribution; role-change guardrails (protected role keys cannot be renamed, owner outside the staff model, sensitive permissions require review, affected users shown before saving, previous snapshot retained, rollback evidence); recent role changes; **Create custom role**.

| Element | Class | Notes |
| --- | --- | --- |
| Role list with permission counts and member counts | Derivable | From `property_role_templates` and assignments |
| Protected system roles; protected keys not renamable | Partial | Template `kind` distinguishes built-in from custom (S183 aligns names) |
| Guardrails (affected users preview, snapshot, rollback evidence) | Gap | G158 |
| **Roles are per hotel in the product (`property_role_templates` has a `property_id`); the design lists one set of roles** | Needs alignment | Built-in templates are seeded per property; custom ones can differ per hotel. The page lists the roles of the selected hotel (S190) |

### Page 22j — Create custom role (design received 2026-10-16)

Four steps (Identity, Permissions, Sensitive access, Review): role name, immutable role key, internal description; permission groups with checkboxes and level (Read, Write, Export, Sensitive); validation (identity, keys valid, responsibility boundary, sensitive access reviewed, affected users); affected users (none until assigned); rollback evidence; creation review; **Save draft** and **Validate & create**. The design says custom roles are for **stable responsibilities, not one-off exceptions**.

| Element | Class | Notes |
| --- | --- | --- |
| Name, immutable key, description | Partial | Template creation exists with a name; key and description are new |
| Permission checkboxes by group | Real | Custom role templates with capabilities already exist |
| Sensitive flags and a required review note | Gap | Sensitive designation of keys and the note are new (G158) |
| Draft state and validation | Gap | Roles are created immediately today |
| Immutable permission snapshot | Gap | G158 |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S189 | **Staff detail security block: last sign-in time, active sessions count, password last changed;** do not collect location or failed-attempt analytics in the first release | Useful and small; geolocation adds privacy exposure |
| S190 | **Roles are per hotel,** matching the data model; creating a role in one hotel does not affect another; the owner can copy a role to another hotel (later) | The product scopes templates to a property |
| S191 | **Create custom role as a single form with a live access preview and a sensitive-permission confirmation,** not a four-step wizard; a draft state is not needed in the first release | Fewer steps for a rare action; sensitive keys still need an explicit confirmation |
| S192 | **Role changes save a before and after snapshot in the audit log and show the affected staff before confirming;** no separate rollback feature in the first release (restore by editing back from the snapshot) | Meets the design's evidence rule without a rollback system |
| S193 | **Mark as sensitive:** provider connections, retry provider operations, staff and role management, exports, refunds | Matches the design's sensitive list, mapped onto real keys |

**Decisions needed**

| # | Question |
| --- | --- |
| D119 | **Decided: yes.** Staff security basics without location; roles per hotel (S189-S190) |
| D120 | **Decided: yes.** Single-form role creation, audit snapshots without a rollback feature, sensitive key list (S191-S193) |

### Page 22k — Permission matrix, User-level overrides (design received 2026-10-16)

**Permission matrix:** the same role-by-key table as Page 21a with Grant and Deny per role and a Change column showing proposed (unsaved) changes ("Booking + Grant"), a search and filters, a **change impact** list ("two proposed grants affect existing users") and Review changes. **User-level overrides:** a registry of explicit allow and deny exceptions with staff, baseline role, reason, expiry; a selected-override panel; a **review queue** (expires, annual review, duty review); a lifecycle (request, review, approve, apply, review, revoke); required governance fields (allow or deny, business reason, approving actor, review date, expiry when temporary, immutable evidence id).

| Element | Class | Notes |
| --- | --- | --- |
| Role-by-key matrix with grant and deny | Derivable | Role templates and their capabilities (11 keys today, D106) |
| Editing the matrix as a batch of proposed changes with an impact preview before saving | Gap | G158; matches S192 (snapshot and affected staff before confirming) |
| Export matrix | Derivable | Export permission and audit (G21) |
| Override registry, selected override, Revoke, Edit review date | Partial | Overrides exist (allow or deny); reason, approver, expiry, review date are G156 |
| Review queue and reminders before expiry | Gap | A scheduled check and a notification type (G171) |
| Override lifecycle with a request and a separate approval | Partial | Decided simpler (S175): reason and optional expiry, no separate approver step in the first release; the **approving actor is the person who creates it** |

### Page 22l — Activity & audit logs (design received 2026-10-16)

Searchable log of staff, role, permission, security, session and export events with actor, action, subject, result and evidence id; counts for today, critical events, unique actors, integrity checks; category filters; an **audit summary** (append-only, actor resolution, before/after snapshots, evidence links, integrity gaps); **integrity verification** (records checked, **sequence gaps, hash mismatches**, retention policy, next check, Run verification); **evidence export** as CSV or JSON, itself audited.

| Element | Class | Notes |
| --- | --- | --- |
| Log list (time, actor, action, subject, result, evidence) | Real / partial | `audit_logs` has actor, actor type, action, target type and id, details and time; staff, role and override actions are logged; **sign-in, session and export events are not** (G173, G136) |
| Filters by category, actor, result, date | Derivable | Categories derived from the action name |
| "Result" labels such as Succeeded, Verified, Expires 31 Jul | Partial | Details field carries the outcome; a normalized result is new |
| Audit event detail (before and after, request context, evidence id) | Partial | Details JSON can hold it; consistent before/after is G149 |
| **Hash chain and sequence-gap verification** | **Gap** | The audit table has no hash chain or sequence number; a verification feature would require new columns and a job (G174) |
| Evidence export (CSV, JSON), audited | Gap | G136 |

### Page 22m — Add override and Edit staff user (design received 2026-10-16)

**Add override:** choose staff, permission, allow or deny, reason, expiry or permanent, review date; effective-access preview; validation. **Edit staff user:** change baseline role, job title, hotel scope and language with an effective-access preview and a change summary.

| Element | Class | Notes |
| --- | --- | --- |
| Pick staff, permission and allow or deny; save | Real | Capability overrides exist per user |
| Reason, expiry, review date, preview of effective access | Partial | G156; the preview is derivable from the resolver |
| Edit baseline role and hotel assignment | Real | Assignments and role template changes exist |
| Job title and language | Gap | G167 |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S194 | **Audit log first release:** a searchable, filterable list with a detail panel (before and after, actor, evidence id) and CSV export; record the missing event families (sign-in, session revoked, password change, export, role and override changes); **no hash chain or "integrity verification" yet** | The audit table is append-only by use; a cryptographic chain is a separate security feature |
| S195 | **If tamper evidence is wanted later, add a sequence number and a hash per row, written by the server in the same transaction, plus a nightly verification job;** do not claim integrity checks before that exists | Do not show "0 hash mismatches" without a mechanism behind it |
| S196 | **Overrides: one form with reason, optional expiry and review date; the creator is the recorded actor;** a daily job sends a notification before expiry or review | Meets the design's governance without a second approver |
| S197 | **Permission matrix editing = a draft of proposed changes with an affected-staff preview, then one confirm that writes a snapshot to the audit log** | Same as S192 |
| S198 | **Audit visibility:** hotel owners and admins see the hotel's access log; only the platform admin sees cross-hotel and system logs | Matches the dashboard split (D76, D100) |

**Decisions needed**

| # | Question |
| --- | --- |
| D122 | **Decided: yes.** Audit log first release is a searchable list with detail and CSV export, recording the missing event families; no hash chain or integrity verification until tamper evidence is explicitly wanted (S194-S195) |
| D123 | **Decided: yes.** Simple override form (creator is the actor, reason, optional expiry and review date); matrix edits as a draft with affected-staff preview; audit visibility by role (S196-S198) |

### Page 22n — Audit event detail (design received 2026-10-16)

One event (staff.role.changed): event summary (time, category, action, actor, subject, result, reason, source route), **integrity chain** (sequence, previous event, previous and event hash, evidence count), **before and after state** (role and key permissions), **request context** (request id, session id, IP address, location, user agent, CSRF validation, permission gate, hotel scope, duration), evidence attachments (before and after snapshots, policy, request), related events in time, an optional **review note**, Export evidence.

| Element | Class | Notes |
| --- | --- | --- |
| Time, action, actor, subject, result, reason | Real / partial | Columns exist: actor, action, target type and id, details, time; reason and result live in `details` (G149) |
| Before and after state | Partial | Recorded for some actions in `details`; consistent before and after is G149 |
| Request context: request id, session id, IP, user agent, duration | **Gap** | Not stored with audit rows (G176). IP address and device data are personal data; keep only what is needed and confirm the retention rule locally (S202) |
| **Location (Tirana office)** | Omit | Not collected (S189) |
| CSRF validation, permission gate | Rule | Server facts; show only the permission that was required |
| Integrity chain (sequence, hashes) | **Gap** | G174; omitted (D122) |
| Evidence attachments (snapshots, policy, request) | Partial | Snapshots are part of the details; separate evidence objects are not needed (S202) |
| Related events (nearby events for the same subject or request) | Derivable | Same target or request id within a window |
| Review note on an immutable event | Gap | Append-only annotation (G177), optional |

### Page 22o — Suspend staff access (design received 2026-10-16)

A full page for a sensitive action: staff identity, last sign-in, active sessions and recent actions, **immediate impact** (sign-in blocked, sessions revoked, role and overrides retained, audit history retained), **reason (required), review date, internal note**, **sessions to revoke** (each with a Revoke), **choose account state** (Suspend access recommended and reversible, or Deactivate account, permanent access removal, use rarely), **typed confirmation** ("SUSPEND"), and an audit statement ("no data deleted").

| Element | Class | Notes |
| --- | --- | --- |
| Suspend or reactivate | Partial | G157 |
| Reason, review date, internal note | Gap | Stored with the audit event; review date drives a reminder notification (G171) |
| List of active sessions with individual revoke | Gap | Sessions are in Redis keyed by session id; listing sessions per user needs an index (G173) |
| Deactivate as a separate permanent removal that keeps history | Partial | Membership rows are kept; a deactivated state is G157 |
| Typed confirmation | Gap | Component C11 (confirm with reason) extended with a typed word |
| "Cancel" and "Suspend access" | Real (UI) | |

### Page 23 (updated) — Notifications: designs received (supersedes the in-house plan)

**Design source:** six Figma PNGs: **Notifications inbox, Unread notifications view, Notification detail (payment callback missing), Notification center states** (and the same layout twice with the Unread filter). The design's model: **personal alerts** (read state is personal and never resolves the underlying issue), **five categories** (Reservations, Payments, Providers, Emails, System), **four priorities** (Critical, High, Medium, Low), filters (all or unread, category, priority, date), counts (unread, critical, today, action links), an inbox summary, a categories and routing card, a **concept boundary** card (Notifications = personal awareness and navigation; Needs Attention = the shared work queue; Emails = outbound guest communication), **Notification settings**, **Mark all as read** and **Mark visible as read**, a **detail page** with related entities, operational context timeline, available actions (permission-checked), per-notification activity and "read and retention" rules (per user, never auto-dismiss, 90 days), and shared states (no new, no results, **limited context for missing permission with the permission name shown**, **partial data**, load failure with a request id, loading).

| Element | Class | Notes |
| --- | --- | --- |
| Inbox list with title, description, priority, category, linked entity, time, unread dot | Partial | Table has type, payload, read time, created time; **priority and category are derivable from the type** (S199); today's four types |
| **Read state per staff user** | **Gap** | `notifications.read_at` is a **single value on the notification, shared by everyone at the hotel**. The design requires per-user read state (G176) |
| Recipients ("finance and admin recipients selected") | Gap | Notifications have no recipients; they are visible to the hotel's staff. Routing by role and permission is new (G177) |
| Category and priority filters, search, date, counts | Derivable | Once G176 and the type mapping exist |
| Mark all read, mark visible read | Partial | Mark read exists; per-user and "visible only" are new |
| Notification settings (mute categories, priorities) | Gap | G172 |
| Link to the right place, permission-aware | Gap | G170; the states sheet's "limited notification context" shows the required permission |
| Detail page with timeline, related entities, actions, activity and retention | Gap | Optional; see S203 |
| 90-day retention | Gap | No retention job (G178) |
| States (empty, filtered empty, limited context, partial data, error with request id, loading) | Real (UI) | Shared pattern (S28) with reference code (G84) |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S199 | **Use the design's five categories and four priorities;** each notification type is assigned one category and one priority in a registry (for example payment callback missing = Payments, Critical); my earlier groups (requests, availability) fold into Reservations and Providers | Matches the owner's design and keeps the registry small |
| S200 | **Per-user read state:** a `notification_reads` table (user and notification); unread count per user; new notifications are visible to every staff member who has the permission for their category | The current shared read flag would mark an alert read for the whole team |
| S201 | **Routing by permission:** a notification is delivered to staff whose capabilities cover its category (payments to those with payments access, providers to admins); owners and admins see all | No recipients table needed at first |
| S202 | **Audit detail: show actor, time, action, subject, result, reason, before and after, request id and the related events; record session id and user agent when the action is a sensitive access change, and keep IP address out unless a local rule requires it;** skip hash chain, evidence attachments and review notes first | Collect the least personal data that serves the purpose |
| S203 | **Notification detail as a side panel on the inbox** (summary, related entities, available actions) instead of a separate page; no per-notification activity log | Clicking already takes users to the linked record; a page per alert adds little |
| S204 | **Suspend and deactivate use a confirm dialog with a required reason and a typed word, not a full page;** the impact list (sessions revoked, role retained, history retained) is shown inside the dialog | Same safety, fewer screens (C11) |
| S205 | **Retain notifications 90 days** (a nightly cleanup) while the underlying records stay forever | Matches the design's rule |

**Decisions needed**

| # | Question |
| --- | --- |
| D124 | **Decided: yes.** Five categories and four priorities in a type registry; per-user read state; routing by permission (S199-S201) |
| D125 | **Decided: yes.** Minimal audit request context (no IP, no location); notification detail as a side panel (S202-S203) |
| D126 | **Decided: yes.** Suspend and deactivate as a confirm dialog with reason and typed word; 90-day notification retention (S204-S205) |

## Staff-dashboard coverage audit (2026-10-16)

The owner has no further designs for the **hotel staff dashboard**. The list below compares everything the product does or needs against the designs received, so nothing is silently missing. "In-house" means we design it ourselves from existing patterns, the same way as Add reservation step 1.

**Covered by received designs:** Overview (all five tabs), Reservations (list, detail, edit, amend, cancellation review, provider review, states), Add reservation (steps 2 and 3), Calendar (all states), Payments (overview, ledger, detail, refund request and review, reconciliation, Clock folios, states), Guests (all), Accommodation (all tabs, listing and unit pages), Rates & Pricing (all tabs), Availability (all tabs), Emails (all), Coupons (later), Reports (all tabs), Settings (overview, General, Booking rules, Check-in & Check-out, Payments summary, Staff & Access, Frontend & Branding, Managed Pages, Notifications & Emails, Billing), Staff (list, detail, roles, permissions, overrides, invite, suspend, audit), Notifications.

**Not covered by any design, still needed for a working staff dashboard:**

| # | Missing piece | Why it is needed | Proposed handling |
| --- | --- | --- | --- |
| M1 | **Add reservation, step 1 (Stay details)** | Entry to every booking | In-house, planned (Page 5a) |
| M2 | **Dashboard shell details:** hotel switcher with a hotel search, user menu items (My account, Sign out), notification bell popover, a global **search** box for bookings and guests | Used on every page; the shell exists but only logout is wired | In-house; global search (reference, guest, phone) is a standard PMS control (S206) |
| M3 | **My account page** (own name, language, password change, own sessions, notification preferences) | Every staff member needs it; a staff member cannot change a password today except by reset | In-house (S207) |
| M4 | **Record a manual payment and settle pay at hotel** (a dialog on the booking) | Core front-desk task; exists today in the old UI | In-house dialog on Booking detail and Payments (uses C11) |
| M5 | **Hotel rules (house rules) page** in Settings (smoking, pets, extra bed, cot, children, minimum age) with unit and listing overrides | Decided (D44) but never designed | In-house (G60) |
| M6 | **Cancellation policies management** (the named policies that rate plans use) | `cancellation_policies` exists and rate plans reference them; Settings has only a number of free days | In-house, inside Rates & Pricing > Rate plans or Settings > Booking rules |
| M7 | **Amenities library** (hotel-wide amenity list with icons, used by listings) | Listings use amenities; today managed in the old room screen | In-house, inside Accommodation (small) |
| M8 | **Guest requests page** (queue for late checkout, early check-in, room change) | The Approvals tab is designed as a card on the Overview, but staff also need the full list and detail | In-house, from the Approvals tab layout (D7, S23) |
| M9 | **Activity log of the hotel** (Overview "View activity log" and a hotel-wide timeline) | Linked from the Overview and Booking detail | Reuse the Activity & audit log page, with a category filter for bookings and payments |
| M10 | **Free-plan lock screen and plan-limit prompts** (account locked after two weeks; seat or property limit reached; upgrade call to action) | Decided in the plan discussion; no screen | In-house, Milestone 15 (S182) |
| M11 | **Setup wizard or first-run checklist** for a new hotel (identity, rooms, rates, payments, publish) | A new hotel has to reach "ready to take bookings" | Use the Settings readiness chain (S162) as a checklist; no separate wizard at first |
| M12 | **Error pages:** no access (403), not found (404), session expired, hotel not available | Needed everywhere, partly covered by state sheets | In-house, using the standard states (S28) |
| M13 | **Print views:** arrivals and departures lists, booking confirmation, registration card | A front desk prints these daily | Milestone 25 (front desk) |
| M14 | **Check-in and check-out, folio, invoices, room status board, daily close** | PMS front desk and stay money | Milestone 25; designs to be supplied or built in-house then |
| M15 | **Guest reviews / review links** | `review_links` is stored on the property; no screen designed | Part of General or Frontend settings; small, in-house |
| M16 | **Hotel profile for guests** (public description, location, gallery, policies shown on the website) | The WordPress site shows hotel information | Part of Frontend & Branding and General |
| M17 | **Phone and mobile layouts** | Owner will supply later | Deferred (D7 design supply) |
| M18 | **Dark mode** | Not requested | Out of scope |

### Suggestions (industry practice) — awaiting owner OK

| # | Suggestion | Why |
| --- | --- | --- |
| S206 | **A global search in the header** (booking reference, guest name, phone, email) that opens the matching record; permission-aware | The fastest way to reach a booking in every PMS |
| S207 | **My account page:** name, language, password change, active sessions with revoke, notification preferences, in the user menu | Self-service reduces owner and admin workload |

**Decisions needed**

| # | Question |
| --- | --- |
| D127 | **Decided: yes.** Global header search and a My account page (S206-S207) |
| D128 | **Decided (owner): all missing items are needed and will be built; they are simply not designed.** They are built from the existing components and reviewed one by one when their turn comes (M1-M16; M13-M14 with Milestone 25) |
| D129 | **Open: brainstorm of the current situation and next step (below, 2026-10-16)** |

## Feature gaps register (design shows it, product does not have it yet)

Add a row whenever a page design shows something the product lacks. Status values: **Open** (needs definition or build), **Decided-omit** (owner chose not to build), **Moved** (belongs to another milestone), **Done**. Gaps are not tasks until the owner schedules them.

| ID | Page | Feature in the design | What is missing | Status |
| --- | --- | --- | --- | --- |
| G1 | Overview | 7-day sparklines and "vs yesterday / vs last week" deltas on the stat tiles | No history is stored. Needs daily snapshots (or historical queries) for arrivals, departures, in-house, occupancy, payments, attention and payment follow-up counts | Open (owner: plan it, 2026-10-16) |
| G2 | Overview (Approvals tab) | Guest requests (late checkout, room change) with approve / decline | No guest-request entity or endpoint; no guest-facing submission path; no decision audit or guest notification. Proposal in D7 | Open (owner: plan it; proposal awaiting OK) |
| G3 | Overview (sidebar) | Events section | No event feature exists. Needs a definition first: what an "event" is for a hotel (bookable events, hotel-hosted events, something else) | Open (owner: plan it) |
| G4 | Overview (System health) | Health card and tab | Sources exist (Clock webhook health, provider events, manual-review items, integration operations) but nothing aggregates them; no PokPay health signal; the designed tab is platform-operator content (see 1e, D6) | Open (owner: plan it) |
| G5 | Overview | Unavailable inventory split into "manual" and "maintenance" | `availability_blocks` stores dates only, no reason | Decided-omit: show one count (owner, 2026-10-16) |
| G6 | Overview | Guest counts on tiles (for example "28 guests") | Confirm that party size is stored per booking and summed correctly | Open (unchecked) |
| G7 | Overview | Payments-received count, payment follow-up counts | Small derivations from booking and payment statuses; confirm statuses cover unpaid / failed / partial | Open (unchecked) |
| G8 | Overview | Source badge (Website / Clock PMS / Walk-in) and room label on recent reservations | Confirm booking source and room assignment are exposed by the reservations list | Open (unchecked) |
| G9 | Overview | Sync chips (Local, Clock "12m behind", PokPay) | PokPay has no equivalent of the Clock health service; "behind by N minutes" needs a defined meaning | Open |
| G11 | Needs attention | Priority levels (Urgent / Review), payment-record issues (not received, partial), recommended next step, Review next, issue search/sort | Attention list is booking-status only today; no priority model; payment issues are not attention items | Open |
| G12 | Quick booking | Child ages, company, country, billing address, additional guests (plus suggested: special requests, expected arrival time) | None of these are stored; needs schema and API changes. Field rules decided in D8 | Open (spec decided) |
| G13 | Overview | Activity log / full activity timeline page | Only a 5-item recent-activity list exists; `audit_logs` data exists but no page | Open |
| G14 | Quick booking | Multi-room booking and per-room guests in the staff UI | Backend accepts `rooms[]`; the walk-in screen is single-room | Open (UI work, no backend gap) |
| G15 | Group dashboard | All-hotels dashboard for the tenant owner | New page; design to be supplied; server-enforced access for tenant role OWNER only (not Admin, not Staff); aggregates the per-hotel numbers across properties | Open (D5) |
| G16 | Reservations | Searchable, filterable, sortable, paged list ("1-4 of 48") | The list endpoint returns every booking and the browser filters. Needs a server-side list with search, status, payment, date type and source filters, sort and pagination; also counts for the quick-view tabs | Open |
| G17 | Reservations | Booking source / channel (Direct, Website, OTA, Request) | No source column on `bookings`; needs a field set at creation (staff walk-in, WordPress widget, API) and a backfill rule for existing bookings. Values decided: Direct, Website (OTA later) | Open (values decided, D12) |
| G18 | Reservations | Payment status badge (Paid, Pending, Unpaid, Partial, Refunded) | Derivable from paid amount, total, refunds, status and payment method, but the exact definition must be written once and shared with the Overview tiles and Payments page | Open |
| G19 | Reservations | "On request" reservation status | No such status; relates to request-to-book and Manual review | Open (owner: planned feature, D11) |
| G20 | Reservations | Saved views, remembered filters, bulk actions, column settings | Per-user preferences storage and bulk endpoints (send email, export) do not exist | Open (if S1-S10 accepted) |
| G21 | Reservations | Export list / results | CSV export of the filtered set with a permission gate (guest personal data) and an audit entry | Open |
| G22 | Settings | Owner-selectable theme (neutral black default; pine, ocean, terracotta exist in the preview) | A saved theme choice per hotel group, applied to every page, and a Settings screen to pick it | Open (D9) |
| G23 | Booking detail / Edit | Change stay dates, room type, rate plan, guests count, guest details on an existing reservation; save with revalidation; payment difference handling; Clock update for Clock hotels | Staff booking modification does not exist (API supports total only). Room assignment part overlaps Milestone 25 | Open |
| G24 | Booking detail | Per-booking activity timeline and "created by / updated by" | Audit log and provider events exist; no per-booking endpoint or actor display | Open |
| G25 | Edit | Internal staff notes; guest preferred language | Neither is stored | Open |
| G26 | Booking detail | Cancellation review (refund amount shown before confirming) | Verify whether a refund preview exists; if not, add one | Open (unchecked) |
| G27 | Add reservation (payment) | Send secure payment link by email, staff-initiated | No emailed payment link exists; needs a staff action that creates the payment request, emails the link (with expiry) and leaves the booking unconfirmed until the paid webhook | Open (owner: later, PokPay link only) |
| G28 | Add reservation (payment) | Apply coupon | No coupon feature | Planned (Page 18); coupon field in step 3 of Add reservation comes with it |
| G29 | Add reservation (payment) | Manual price adjustment before creation | Needs a permission, reason and audit entry; today only a post-creation total change exists | Open |
| G30 | Add reservation | Save draft and resume | A DRAFT status exists; confirm whether drafts can be persisted and resumed from staff UI | Open (unchecked) |
| G31 | Add reservation (guest) | Estimated arrival, bed preference, accessibility, nationality, country of residence, additional guests with relationship and guardian | None are stored; structured request tags (S22) cover bed, accessibility and arrival | Open |
| G32 | Cancellation | Cancellation request and approval: requester, reason category, priority, attachments, reviewer, immutable decision note, "cancellation pending" status | No request entity, no pending state, no approval step | Open (D21, S23) |
| G33 | Cancellation | Policy snapshot versioning ("Version 3, stored at confirmation") and penalty display | Bookings store the free-cancellation window and cutoff only; no policy version | Open (unchecked) |
| G34 | Cancellation | Three decisions: full eligible refund, no refund, custom refund (finance permission) | Refund by amount or percentage exists; the choice flow and permission gate are new | Open |
| G35 | Cancellation | Credit note or refund document on approval | No financial documents until Milestone 25 | Moved to Milestone 25 |
| G36 | Amend reservation | Amendment record (draft, snapshot, effective date, who approved, guest approval) and apply-after-payment flow | New; extends G23 | Open (D22) |
| G37 | Amend reservation | Room move and split stay with effective date | Room assignment belongs to Milestone 25 | Moved to Milestone 25 |
| G38 | Provider review | Reviewer assignment, severity, staff-run reconciliation check, evidence view, resolution choices (link existing, retry, escalate, mark failed), checklist, redacted payload viewer, attempts timeline | Review items are Open/Resolved only, resolved in platform admin with one action | Open (D23, S27) |
| G39 | Reservations states | "Checking data freshness" and "last successful refresh" | Derivable from the list query's last-updated time | Open (small, UI) |
| G40 | Calendar | Room status chips Ready / Issue, out-of-service rooms | Housekeeping and room status board belong to Milestone 25 | Moved to Milestone 25 (owner: plan it, D26) |
| G41 | Calendar | Block reason, reference, title, internal note and creator on availability blocks | `availability_blocks` stores dates and room targets only | Open (decided: yes, D27) |
| G42 | Calendar | Range query (7/14/30 days) returning reservations for the visible window | Today the calendar is a month of availability counts; bookings come as the full list | Open |
| G43 | Calendar | Reservation bars, unassigned lane, drag to move/extend | New grid component (C26); drag depends on G23 and G37 | Open (phased, S31) |
| G44 | Calendar | Full availability management page (rates, minimum stay, stop-sell per day) | Not designed | Decided-omit (D28) |
| G45 | Calendar | Blocks created in MUST are sent to Clock as a stop-sale (provider synchronization) | Not implemented; only the read direction (Clock stop-sale shown in MUST) exists | Open (decided: yes, D30) |
| G46 | Calendar | Last confirmed snapshot of the calendar and read-only stale mode | No cached snapshot; Clock circuit-breaker and health data exist | Open |
| G47 | Calendar | Setup checklist when Clock rooms are not mapped | Derivable from Clock mapping state; the actions already exist in Integrations | Open (small) |
| G48 | Accommodation | Listing publish status (Draft / Live / Hidden) and storefront publishing | Room types have no status field; the public catalog lists every room type | Open (D34) |
| G49 | Accommodation | Categories: entity, listing assignment, order, storefront visibility, URL path; public catalog and WordPress plugin use | Does not exist anywhere | **First release (owner, D33)**: every room type has a category |
| G50 | Accommodation | Unit active / inactive state | Rooms have no such flag | Open |
| G51 | Accommodation | Server-side readiness checks (basic info, occupancy, rate plan assigned, inventory source, units mapped, availability verified, publishing) | Derivable; each check needs one written definition | Open |
| G52 | Accommodation | Inventory source conflict detection | Undefined; with one source per hotel (S44) it reduces to unmapped or duplicated rooms | Open (D35) |
| G53 | Accommodation | Excel / CSV import with preview and error report, and export | No spreadsheet support exists | Open (D36: later) |
| G54 | Accommodation | Updated by / updated at on listings, units and categories, and publish / import events in activity | Audit log exists; these events and fields do not | Open |
| G55 | Accommodation (Listings) | Listing code and URL slug (unique, generated) | Room types have neither | Open |
| G56 | Accommodation (Listings) | Bed configuration (bed type and count) per listing | Not stored | Open |
| G57 | Accommodation (Listings) | Pricing readiness: "needs pricing" (no base price) and "conflicting pricing rules" | Rate plans, rules and overrides exist; the two conditions need written definitions and a server check | Open |
| G58 | Accommodation (Listings) | "Mode" filter (instant / on request) | Depends on the On-request feature (G19) | Open (hidden until G19) |
| G59 | Accommodation (Listings) | Bulk actions (assign category, publish, hide) and listing pagination endpoint | Not implemented | Open (D40) |
| G60 | Accommodation (Listing) | Guest and stay rules: smoking, pets, extra bed, cot, accessible, children accepted, minimum guest age (override of hotel defaults) | Not stored; hotel-level defaults would live in Settings | Open (decided: hotel default, override per listing and per unit, D44) |
| G61 | Accommodation (Listing) | Short public description and internal description (besides the full public description) | Only one description field exists | Open |
| G62 | Accommodation (Listing) | Listing facts: maximum adults, maximum children, size m2, bedrooms, bathrooms, view type, floor information | Only maximum occupancy is on the room type; some facts exist per room | Open |
| G63 | Accommodation (Listing) | Storefront label (for example Popular), browser title and meta description, preview link | Not stored | Open |
| G64 | Accommodation | Archive listing / archive unit, and delete only when nothing references it | No archive state; delete rules unverified | Open |
| G65 | Accommodation (Units) | Unit code, internal alias, wing/area, building, access notes, location notes, staff notes | Rooms store name, floor, view, title, size, rules, description only | Open |
| G66 | Accommodation (Units) | Unit presentation overrides (public name, short description, cover image, customer note) | Not stored; only for exact-room hotels (D43) | Open |
| G67 | Accommodation (Units) | "Current context": occupied today with checkout date, available today, blocked today | Derivable from bookings with an assigned room, blocks, and Clock stay data | Open |
| G68 | Accommodation (Units) | Mapping verification history and "mapping blocks availability until revalidated" safeguard | Mapping rows and timestamps exist; revalidation behavior must be defined | Open |
| G69 | Accommodation (Import/Export) | Import and export jobs with stored files, results and error reports; spreadsheet library; file storage | None exists; object storage (R2) is not configured on every host | Open |
| G70 | Accommodation (Setup warnings) | Issue assignment, "in progress" and "resolved" state tracking | Issues would be derived automatically; state needs storage | Open (S65: not in first release) |
| G71 | Accommodation (Setup warnings) | Stable rule codes and a "recently resolved" history | Needs a registry of rules and a history of issue state | Open |
| G72 | Rates & Pricing / Settings | Property time zone: `Europe/Tirana` is rejected by the local Node runtime | Verified locally only; check the production runtime and choose a reliable time-zone list or equivalent | Open (to verify) |
| G73 | Rates & Pricing | Pricing engine v2: pricing rules (percentage or fixed, rounding, scope by room type and rate plan, stay conditions, days, booking window, priority, status, versions, change note), derived rate plans, occupancy supplements | None of it exists; today only absolute prices per rate plan and room type | Open (D50, D51) |
| G74 | Rates & Pricing | Taxes and mandatory fees (tax-exclusive entry, customer display, effective dates, per person or per night) | No tax or fee model exists; the Taxes & fees tab has not been supplied | Open |
| G75 | Rates & Pricing | Full immutable pricing snapshot per booking (base, rules, plan, supplements, taxes) | Bookings store nightly rates and the total only | Open |
| G76 | Rates & Pricing | Pricing source per hotel (Clock read-only vs MUST engine) | Not modelled in the UI; Clock hotels use Clock rates today | Open (D49) |
| G77 | Rates & Pricing | Base price calendar editor and bulk update with preview, reason and audit | Rules can be created one by one; no grid, no preview | Open |
| G78 | Rates & Pricing | Price coverage, pricing issues and nightly validation of the booking horizon | Derivable; each issue needs a definition; Issues tab not supplied | Open (D52) |
| G79 | Rates & Pricing | Price explainer (line-by-line calculation for a room type, date and plan) | Not built | Open (S70) |
| G80 | Rates & Pricing (Rate plans) | Rate plan model: code, status and version history, derived or independent pricing, adjustment (percentage or fixed per guest per night), rounding, meal plan, payment terms, room-type scope, channels (Web, Staff), fallback role, booking window, restrictions (min and max stay, occupancy, closed to arrival/departure), publication period | Rate plans have name, active flag, currency and cancellation terms only | Open (D54) |
| G81 | Rates & Pricing | Rate plan `fallback` role and "cannot publish" checks | Not modelled | Open |
| G82 | Rates & Pricing (Issues) | Issue states Monitoring and Deferred, stable issue codes (P-BASE-002) | Same engine as G70/G71 (S78) | Open |
| G83 | Rates & Pricing (States) | "Request access" workflow for permission-denied screens | No workflow; replaced by a plain message (S79) | Decided-omit for first release |
| G84 | All pages (error states) | Reference code on errors shown to staff (for example PRC-LOAD-500) | A request id exists in logs; it is not shown in the UI | Open (small) |
| G85 | Availability | Restriction model: types (min stay, max stay, closed to arrival, closed to departure, stop sell, min and max advance), scope (property, categories, listings, rate plans), schedule (dates, weekdays), priority, lifecycle (Draft, Scheduled, Active, Paused, Expired), validation, references (RST-2026-0018), history; used by search, quotes and the calendar | Today only property-wide minimum stay, maximum stay and advance days exist | Open (D58-D60) |
| G86 | Availability | Booking-effect preview ("test a stay") using the live evaluation code | Not built | Open (S83) |
| G87 | Availability | Coverage grid and KPIs ("86% open", pipeline counts) | Derivable from availability, blocks, restrictions and readiness | Open |
| G88 | Availability | Provider and inventory health summary (last incremental sync, last full validation, provider units received, failed operations) | Clock health data exists in pieces; no summary | Open |
| G89 | Availability | Manual blocks list with reason, creator, status and "ends in N days" | Extends G41; Manual Blocks tab not supplied | Open |
| G90 | Availability | Conflict detection between restrictions and the Conflict Review tab | Not supplied; part of the shared issues engine (S78) | Open |
| G91 | Availability | Upcoming restriction schedule (bars on a timeline) | Reuses component C26 | Open |
| G92 | Availability (Manual blocks) | Manual block model v2: title, reason, reference, purpose, responsible staff, lifecycle (Draft, Scheduled, Active, Ended, Cancelled), validation, early end with reason, versioned edits, history | Blocks store dates and targets only (extends G41) | Open (D63-D66) |
| G93 | Availability | Block-vs-reservation, checkout-lock and existing-block conflict detection | Not implemented; payment-pending holds exist and can serve as "checkout locks" | Open |
| G94 | Availability | Clock write path for room-level closures (D30) | **Unverified**: only the read direction of Clock stop-sale exists; must be proven against the sandbox | Open (S93) |
| G95 | Availability | Restriction usage counters | Would need logging every search | Decided-omit for first release (S88) |
| G96 | Availability | Restriction edit rules: material vs non-material changes, validation snapshots and versions | New | Open |
| G97 | Payments | Payment state model for the UI: confirmed, verifying, reconcile, folio retry, refund review, failed, refunded, separated from booking and accounting states | Derivable from payment status, provider events and folios; needs one written definition shared with the Overview and Reservations (G18) | Open |
| G98 | Payments | Staff actions Recheck provider payment and Retry Clock folio posting (idempotent) | Reconciliation and webhook processing exist; staff-triggered buttons must be verified or added | Open (unchecked) |
| G99 | Payments | Human-readable payment reference (PAY-1084) | Payments have UUIDs only | Open |
| G100 | Payments | Per-payment evidence timeline | Provider events and audit exist; no per-payment endpoint | Open |
| G101 | Payments | Provider fee captured and shown; refund amount net of fee | Not stored | Open (S100) |
| G102 | Payments | Refund reason category, requester, customer message and notify option | Only an amount or percentage and a note exist today | Open |
| G103 | Payments | Refund as an explicit request with approval and a manual-fallback state (manual_pending) | Refunds execute immediately today; manual fallback unverified | Open (D69) |
| G104 | Payments | Refunds, Reconciliation, Clock folios and Gateways tabs | Not supplied; sources exist (refund records, provider events, manual review, Clock folios, connections) | Open (D72) |
| G105 | Payments | Reconciliation case record: id (REC-012), type, owner, status, notes, repair action, resolved time | Cases exist as states and manual-review items without a case record | Open (S108) |
| G106 | Settings (payments) | Test callback and last webhook delivery view | Provider events exist; no test call | Open |
| G107 | Settings (payments) | Credential versions, rotation flow, credential audit | Credentials are replaced in place | Open (S111) |
| G108 | Payments | Staff-run "Run reconciliation" and export evidence | Reconciliation jobs run on a schedule; no staff trigger or export | Open |
| G109 | Guests | Human-readable guest ID (GST-1248) and search by it | Guests have UUIDs only | Open (S114) |
| G110 | Guests | Guest flags (VIP, Accessibility assistance, Preference, Attention) with priority and review date; internal guest notes (profile and reservation-linked), append-only with audit | Not stored; extends G25 | Open (D78) |
| G111 | Guests | Masking of phone and email in lists by capability | Capability exists; masking behavior new | Open (S117) |
| G112 | Guests | Contact verification ("email and phone verified") | Not stored; no way to verify phones | Decided-omit (S119): show on-file status |
| G113 | Guests | Manual Add guest without a booking | Guests are created via bookings | Open (S120) |
| G114 | Guests | Returning-guest and first-time classification, last and next stay, bookings count per hotel | Derivable from bookings | Open |
| G115 | Guests | Lifetime value and outstanding balance | Derivable from payments and refunds; definition in S118 | Open |
| G116 | Guests | Guest data export, retention, erasure and consent handling | Not defined; needs a legal check per country (Milestone 25 question 7, ADR-0009) | Open (D80) |
| G117 | Guests | Server-side directory (paging, type, hotel, sort filters) | The list endpoint takes a search term only | Open |
| G118 | Emails | "Suppressed" outcome with a reason in the email log | Not recorded; only queued, sent, failed, delivered, bounced and complained exist | Open (S127) |
| G119 | Emails | Template versions (live and draft), publish and restore, enable or disable state, required-variable validation, allowed-variable list, preheader, plain-text fallback, locale coverage and fallback, change summary | Templates store subject and body per language only; ties to Milestone 22 tasks 10 to 14 | Open (D82, D83) |
| G120 | Emails | Partial-fulfilment resolution email | No such event; depends on how multi-room partial outcomes are handled | Open (S124) |
| G121 | Emails | Staff-labelled manual resend of an approved email snapshot, with actor, recipient and reason | Resend is not implemented as a labelled action (verify) | Open (unchecked) |
| G122 | Emails | Delivery and Configuration tabs | Not supplied | Open (D84) |
| G123 | Emails | Test emails recorded separately from guest metrics, with reason and actor | Test send is a Milestone 22 task; separate category is new | Open |
| G124 | Emails | Suppression list (hard bounce, complaint, unsubscribe), manual unsuppress with privilege and reason | Bounced and complained statuses exist; no suppression list | Open (S132) |
| G125 | Emails | Domain authentication diagnostics (SPF, DKIM, DMARC, return-path, alignment) | Milestone 22 task 18; no DNS checks exist | Open (S134) |
| G126 | Emails | Platform and hotel configuration split; credential rotation | Milestone 22 tasks 16 to 20 | Open (D85) |
| G127 | Emails | Per-message detail with sanitized provider response and attempt timeline | Attempts and last error exist; timeline and sanitized response display are new | Open |
| G128 | Emails | Incident record (severity, owner, close) around a failed email | Not built; a failed message is enough at first | Decided-omit first release (S131) |
| G129 | Coupons | Coupon model: name, code, discount type and value, lifecycle (Draft, Scheduled, Active, Inactive, Expired, Fully used), booking and stay windows, eligibility, global and per-guest limits, locked code after first use, edit and audit | Does not exist | Open (D88-D91) |
| G130 | Coupons | Redemption records and usage traceability (applied, retained, reversed) linked to reservation and payment; granted total, net discount, export | Does not exist | Open |
| G131 | Coupons | Applying a coupon: quote and checkout API, public booking widget field and messages (WordPress plugin), staff booking step 3 | None of these have a coupon concept | Open |
| G132 | Coupons | Redemption reservation during checkout hold, release on failure and expiry, return on cancellation, concurrency-safe limit | New; reuse the inventory-hold pattern | Open (S139) |
| G133 | Coupons | Coupon discount in the price order, the stored booking price snapshot and refunds | Depends on G73 and G75 | Open (S135) |
| G134 | Reports | Report metrics layer: written definitions and queries for reservations, revenue, collected, refunded, net, occupancy, lead time, length of stay, pickup | Today three daily series only | Open (S143) |
| G135 | Reports | Filters (source, room type, status, payment, mode, currency), comparison period, rows table with paging | Not built | Open |
| G136 | Reports | Report export with filters, basis, time zone, actor and time recorded | No export exists | Open (extends G21) |
| G137 | Reports | Charts and cards needing missing data: source and channel, instant versus on request, refund reasons, reconciliation, blocked versus out-of-service, tax breakdown | Depend on G17, G19, G102, G105, G41, G74 | Open (hidden until data exists, S148) |
| G138 | Reports | Accommodation report (room type ranking, unit drill-down) | Derivable from the metrics layer; unit level only with room data | Open (S153) |
| G139 | Reports | Booking conversion (search to booking) | No search or visit events are stored | Open (S152) |
| G140 | Reports | Saved report views (owner, visibility, base report, filters, columns, grouping) and recent exports history | Not built | Open (S150, S154) |
| G141 | Reports | Performance score and generated insights | Invented; no formula defined | Decided-omit (S151) |
| G142 | Reports | PDF export | Needs a renderer | Open (later, S155) |
| G143 | Integrations (admin) | Overview metrics with defined windows (sync health %, webhook delivery %), staff-triggered Run health check and Sync now (idempotent) | Pieces exist; no aggregate or triggers | Open |
| G144 | Integrations (admin) | Operation list and job detail with per-attempt timeline, retry gates, Run remote check | Operations carry an attempts count and a result only | Open |
| G145 | Integrations (admin) | Provider request log store: redacted requests and responses, correlation ids, latency, 30-day retention, export evidence | Provider HTTP calls are not stored as records | Open (S158) |
| G146 | Integrations (admin) | Booking diagnostic view assembled from payment, booking, operation, folio and Clock evidence | Facts exist separately | Open (S160) |
| G147 | Integrations (admin) | Manual-review cases with assignee, claim, SLA, evidence checklist, decision record | Open and Resolved only (extends G38) | Open (S159) |
| G148 | Integrations (admin) | Sync Ops controls: Pause queue, manual Run sync | Not built; risky | Decided-omit first release (S157) |
| G149 | Settings | Change history with before/after summaries per setting and actor | Audit exists; before/after is not recorded for settings | Open (S170) |
| G150 | Settings | Validation-before-save model with a checklist and change impact; settings versions where needed | Settings save directly today | Open (S163) |
| G151 | Settings (General) | Public hotel name, property code, operational status, structured address (country, city, postal code, line 2), map pin, reservations and operations contacts, emergency label, public contact visibility, default display name | Not stored; extends the single address and contact fields | Open |
| G152 | Settings (General) | Property locale, date and time format, week start, phone country code; currency at property level | Currency lives on rate plans; formats do not exist | Open (S164) |
| G153 | Settings (Booking rules) | Master public-booking switch, customer self-modification, rooms-per-booking limit, booking-type defaults | Not stored; no customer accounts exist | Open |
| G154 | Settings | Real health and end-to-end booking readiness chain | Derivable from the readiness engine | Open (S162) |
| G155 | Settings | Dangerous Reset | Not required | Decided-omit first release (S169) |
| G156 | Staff & Access | Override reason, approver, temporary expiry | Per-user allow or deny overrides exist; no reason or expiry | Open (S175) |
| G157 | Staff & Access | Suspend and deactivate accounts with session revocation and audit | Verify what exists | Open (unchecked) |
| G158 | Staff & Access | Role-change impact preview and rollback evidence | Not built | Open (S176) |
| G159 | Staff & Access | Permission model: read and write pairs and the design's 18 keys | Product has 11 keys; adoption must follow real screens | Open (D106) |
| G160 | Settings (Check-in/out) | Early check-in and late check-out request types and arrival-time capture | Part of guest requests (G2) | Open (S171) |
| G161 | Settings (Payments) | Overall public payment policy and collection timing | Per-method switches only | Open (D57, S174) |
| G162 | Staff Users | Staff reference (STF-001), last sign-in, device summary, security posture | Not recorded | Open (S177) |
| G163 | Staff Users | Pending-invitation record with expiry and resend | Token in Redis only | Open (S181) |
| G164 | Branding | Published public-branding theme (assets, colors, labels, contrast check, versions, rollback) delivered to the WordPress plugin | Only a logo URL exists | Open (S179) |
| G165 | Managed Pages | Plugin-reported registry (page, route, template, health) and idempotent repair, shown in the dashboard | Plugin has ManagedPages.php; no reported registry | Open (S180) |
| G166 | Billing Account | Plan, usage, invoices, payment method, billing details, free-period lock | Milestone 15 | Moved to Milestone 15 (S182) |
| G167 | Staff Users | Staff full name, job title and language stored on the staff profile | Not stored; invitation carries only email, role and hotel | Open (S188) |
| G168 | Staff Users | Real session timeout value shown and enforced | Verify the actual session lifetime | Open (unchecked) |
| G169 | Notifications | Needs-action flag, resolved state and group per notification | Only read time exists | Open (S187) |
| G170 | Notifications | Destination for each notification type, computed from the payload and permission-checked | No links stored | Open (S185) |
| G171 | Notifications | New notification types raised by new features (guest requests, review cases, failed emails, provider and sync problems, cancellation and amendment requests, plan limits) | Four types exist today | Open (S186) |
| G172 | Notifications | Per-user preferences (groups, in-app or email) | Hotel-level topic settings only | Open |
| G173 | Staff Users | Sign-in, password-change and failed-attempt events recorded per staff member | Not recorded | Open (S189) |
| G174 | Audit | Tamper-evident audit: sequence numbers, per-row hashes, verification job and report | Does not exist; the design shows integrity checks that have no mechanism today | Open (S195) |
| G175 | Audit | Event families not yet logged: sign-in, session revoked, password change, report and data exports | Only staff, role and override and some provider actions are logged | Open (extends G173) |
| G176 | Notifications | Per-user read state and per-user unread counts | `read_at` is one shared value per notification | Open (S200) |
| G177 | Notifications / Audit | Routing of notifications by permission and category; audit annotation (review note) | No recipients model | Open (S201) |
| G178 | Notifications | 90-day retention job | None | Open (S205) |
| G179 | Audit | Request context on audit rows (request id, session id, user agent) | Not stored | Open (S202) |
| G10 | Overview (sidebar) | Invoices, Reconciliation | No invoice module | Moved to [Milestone 25](25-native-pms.md) (invoices in minimum scope); reconciliation screen to be defined there |

## Missing components (plain-language list)

Owner rule (D10): build every page from the components already built; when one is missing, say so here in simple words. "In `/design` only" means it exists in the preview but is tied to demo data and must be cleaned up before real screens can use it.

| # | Component | What it does, in simple terms | Needed by | Status |
| --- | --- | --- | --- | --- |
| C1 | Date range picker | A small calendar where staff pick a start and end date (stay dates, filters) | Reservations, Edit, Quick booking, Calendar | In `/design` only (demo version); the real one must work with real dates |
| C2 | Pagination bar | "1-4 of 48" with page buttons and rows per page | Every list | In `/design` only |
| C3 | Stat tile | A card with a label, a big number and a small note | Overview, summary strip | In `/design` only |
| C4 | Text area | A multi-line box for notes and special requests | Edit, Quick booking | **Missing** |
| C5 | Number stepper | A box with minus and plus buttons for adults and children | Quick booking, Edit | **Missing** |
| C6 | Searchable dropdown | A dropdown you can type into to find a country or language | Guest forms, filters | **Missing** (the existing dropdown cannot search) |
| C7 | Form field wrapper | Puts a label, a hint and an error message around any input in one consistent way | Every form | **Missing** |
| C8 | Detail list | Neat "label: value" rows for detail pages | Booking detail, Payment detail | **Missing** |
| C9 | Filter chips | Small removable tags showing the active filters | Reservations, other lists | **Missing** (can be built on the existing badge) |
| C10 | Quick-view tabs with counts | Tabs such as "Arriving today (7)" that switch the list instantly | Reservations, Needs attention | Partly there (tabs exist; counts do not) |
| C11 | Confirm dialog with reason | A pop-up that asks "are you sure?" and requires a written reason before a sensitive action | Adjust price, cancel, refund | **Missing** (basic dialog exists) |
| C12 | Activity timeline | A vertical list of what happened and when | Booking detail, Overview | In `/design` only |
| C13 | Status badge in the new style | The coloured Confirmed / Paid / Pending labels | Everywhere | Old version exists in the previous UI package; the new style must be built on the new badge (one shared status-to-colour map) |
| C14 | Empty, error and loading panels | The friendly screens shown when there is no data, something failed, or data is loading | Every page | Old version exists; must be rebuilt in the new style |
| C15 | Row actions menu | The three-dot menu at the end of a table row | Reservations and other tables | Can be built from the existing dropdown menu |
| C16 | Theme provider | Applies the hotel owner's chosen theme everywhere and remembers it | Whole app, Settings | In `/design` only (preview switcher); real saved version needed (G22) |
| C17 | Step indicator | A row showing "Stay details > Guest information > Payment & review" with the current step highlighted | Add reservation | **Missing** |
| C18 | Selectable option cards | Large clickable cards where you pick one option (for example how to collect payment) | Add reservation, Settings | **Missing** |
| C19 | Checklist panel | A list of checks, each with a small status (Complete, Needs attention) | Add reservation, System health | **Missing** |
| C20 | Sticky action bar | A bar fixed to the bottom with the main buttons so they are always reachable on long forms | Add reservation, Edit | **Missing** |
| C21 | Phone input with country code | A phone field with a country-code picker next to it | Guest forms | **Missing** |
| C22 | Breadcrumb | "Reservations / Add reservation" trail | Detail and flow pages | In `/design` only |
| C23 | Before / after comparison table | A table with Original, Revised and Difference columns for price and stay changes | Edit, Amend | Can be built on the existing table |
| C24 | Radio group | A set of round options where you pick exactly one (cancel with refund, without refund, custom) | Cancellation, Amend, Add reservation | **Missing** |
| C25 | Payload viewer | A monospace box with tabs for request, response and mapping, with secrets hidden | Provider review (platform admin) | **Missing** |
| C26 | Timeline grid (tape chart) | A big grid with rooms down the side and dates across the top, where each reservation is a coloured bar across its nights | Calendar, later Reservations timeline | **Missing** (the largest new component) |
| C27 | Segmented control | A small row of connected buttons to choose one option (7 / 14 / 30 days, Reservations / Availability) | Calendar, filters | **Missing** (small) |
| C28 | Slide-over detail panel | A panel that slides in from the right with details of what you clicked (a calendar cell, a reservation preview) | Calendar, Reservations | Can be built from the existing side sheet |
| C29 | Sortable list | A list whose rows you drag to reorder (category order, storefront order) | Categories, photos | **Missing** (drag-and-drop library dnd-kit is already approved for this project) |
| C30 | Page-level tab bar with icons | The pill-shaped tab strip at the top of a section (Overview, Categories, Listings, ...) | Hotels/Accommodations, Overview | Can be built on the existing tabs |
| C31 | File drop zone | A box where you drag or choose a file to upload (a cover picture, an Excel workbook), with a validation checklist underneath | Listing, Unit, Photos, Import | **Missing** |
| C32 | Setting toggle row | A row with a title, a one-line explanation and an on/off switch | Listing rules, Settings | Can be built on the existing switch |
| C33 | Editable price grid | A spreadsheet-like table of rooms and dates where you click a cell to type a price and see which cells are base, changed by hand, or missing | Base prices | **Missing** |
| C34 | Weekday picker | A row of Mon to Sun buttons where you toggle which days apply | Pricing rules, Base prices, Blocks | **Missing** (small) |
| C35 | Multi-select dropdown | A dropdown where you tick several options and it shows "3 selected" (room types, rate plans, channels) | Rules, Rate plans, Filters | **Missing** |
| C36 | Coverage heat grid | A table of listings and days where each cell shows a number such as 3/4 and is coloured by how much is left (available, low, sold out, restricted) | Availability overview, Calendar (Availability view) | **Missing** (shares code with C26) |

## Shared component register

Filled in after intake. Initial candidates already built (see Foundation): the 20 primitives in `apps/web/components/ui/` plus the app shell. Known repeated patterns to unify once more pages are seen: stat tile, section tabs, data table + toolbar + pagination, status/source badges, list row, empty/error/loading states (reuse `StatePanel` semantics), confirm dialog with reason (sensitive actions), form field groups.

## Task list

_Defined when intake is complete, one task per page plus the shared-component task and the verification task. Do not create task rows from the intake table early._

## Explicitly not included

- Login, signup, password reset, email verification and other auth pages.
- New backend features (trend history, approvals, events, block reasons) unless the owner funds them as separate tasks.
- Native PMS features — Milestone 25.
- Platform billing — Milestone 15.
