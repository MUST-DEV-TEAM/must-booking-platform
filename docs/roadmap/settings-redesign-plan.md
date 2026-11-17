# Settings redesign plan (2026-11-17)

The property Settings area (`?section=settings`) reviewed end to end: structure, content, UI, frontend and backend. Goal: one obvious place for each setting, nothing duplicated, nothing dead, the same components everywhere, and every screen working for both Clock hotels and native-PMS hotels.

Main files: `apps/web/app/dashboard/settings.tsx`, `settings-hub.tsx`, `settings-areas.ts`, `settings-forms.tsx`, `settings-connection-forms.tsx`, `hotel-settings-fields.tsx`, `display-currencies-settings.tsx`, `integration-settings.tsx`, `email-settings.tsx`, `[tenantId]/integrations-management.tsx`, `dashboard-shell.tsx`; API `apps/api/src/tenancy/properties.service.ts`, `properties.controller.ts`, `apps/api/src/integrations/`.

## What is wrong today

| ID | Problem | Evidence |
| --- | --- | --- |
| P1 | Emails has two homes: the sidebar "Emails" and Settings → Emails render the same 5,700-line workspace. | `email-settings.tsx` only wraps `EmailsWorkspace`; `dashboard-shell.tsx` renders both |
| P2 | Payment providers are switched on in two places with two different switches: Integrations ("Enable for this hotel") and Payments (the Stripe/PokPay toggles). G-35 was a bug born from this. PokPay is labelled "Pay online in full", Stripe is labelled "Stripe". | `integration-settings.tsx`, `PaymentSettings` |
| P3 | The same field is edited on two pages under different names: `supportEmail` is "Guest contact email" (General) and "Support email" (Branding); `phone` is "Guest contact phone" and "Hotel phone". A third address, "Reservations email", sits next to them. The hold minutes are editable in Payments and repeated as read-only text in Booking rules. | `hotel-settings-fields.tsx:30-45`, `settings-connection-forms.tsx:107-113`, `settings-forms.tsx` |
| P4 | The cancellation policy is spread over three pages: free-cancellation days in Booking rules; automatic refund, payment fee and Clock cancellation rule in Payments; the terms link in Branding. Children, pets, quiet hours and ID live in Check-in & check-out; house rules in Booking rules. | the forms above |
| P5 | Check-in & check-out is a whole area for two times plus policy fields that belong with the other policies. | `CheckInOutSettings` |
| P6 | Integrations mixes scopes and clutter: account-wide connections shown inside one hotel's settings ("Applies to every hotel using this connection"), four "Coming soon" cards (PayPal, Booking.com, Airbnb, SMTP), category tabs for three real items, a hard-coded dark colour for PokPay, the Clock sync status shown twice (inline and in a dialog), the restaurant card wedged in. | `integration-settings.tsx:245-470`, `INTEGRATIONS` list |
| P7 | Activating a connection is run from the browser: create, test, link, and on failure a client-side delete. A closed tab leaves half-made connections; nothing is atomic. | `integration-settings.tsx` `save` mutation |
| P8 | Billing account shows a disabled button "Platform billing is not available yet". | `settings.tsx` billing panel |
| P9 | Two UI kits on one page: `@must/ui` (`Card`, `Heading`, `Stack`, `Text`, `must-button`) in `settings.tsx` for the loading, error and billing states, `components/ui` everywhere else. The loading state is plain text while the hub uses a skeleton. | `settings.tsx` imports |
| P10 | Navigation: each area is a separate page reached from a card grid, with a "← Back to Settings overview" link. No settings side menu, so moving between areas takes two clicks and the reader loses their place. The hub's card grid repeats the readiness checklist above it. | `settings-hub.tsx`, `settings.tsx` |
| P11 | Mixed save models on one page: General uses a save bar, while Display currencies on the same page saves instantly on each click. | `display-currencies-settings.tsx:215,291` |
| P12 | Dead code: `IntegrationsManagement` (869 lines) is never rendered; only its `credentialFieldsByProvider` map is imported. | `grep IntegrationsManagement` |
| P13 | Backend: one wide `PATCH /properties/:id` for about 60 columns, and the same column list copied into 6 SELECTs in `properties.service.ts`. Area health ("Ready", "Needs attention") is computed in the browser, and the hub, the settings page and the Hotels directory each make 4 requests for it. | `properties.service.ts`, `settings-areas.ts` `areaHealth` |
| P14 | Missing against industry practice (Mews, Cloudbeds, SiteMinder, Little Hotelier): a Taxes and fees area (prices shown with or without VAT, city or tourist tax per person per night). EU price-display rules expect the total with mandatory taxes. | no tax settings in web or API |
| P15 | Wording is staff-unfriendly in places: "Inventory mode", "Public website origin", "Deposit folio (advance invoice)", area key `managed-pages` for "Website connection". | the forms above |

## New structure

A settings layout with a left side menu (a select on phones), grouped, with the current area highlighted. The overview page keeps only the "Ready to take bookings" checklist. Every area page has one form and one save bar (instant-save only for toggles that are clearly on/off actions, and then everywhere the same way).

| Group | Area | Contents | Replaces |
| --- | --- | --- | --- |
| Hotel | **Profile** | Name, legal name, tax number (NUIS), address, country, time zone, star rating, description, guest languages, date format, default currency, display currencies (saved with the same save bar) | General |
| Hotel | **Contact and brand** | One guest contact email, reservations email (only if different, with a hint), phone, website, logo, brand colour, email footer, live email header preview | contact parts of General, Branding |
| Booking | **Booking rules** | Stay limits, booking window, same-day booking and cutoff, booking size limits, how guests choose rooms (room type, specific room, both) | Booking rules minus policies |
| Booking | **Policies** | Check-in and check-out times, early and late arrival, cancellation (free days, automatic refund, who pays the payment fee), no-show, children, pets, ID at arrival, quiet hours, house rules, terms link; a "Guests will read" preview of the generated policy text | Check-in & check-out, policy parts of Booking rules, Payments and Branding |
| Booking | **Taxes and fees** (new, owner decision O2) | Prices include VAT yes/no and rate, city tax per person per night, shown on the booking page total | nothing today |
| Payments | **Payment methods** | Pay at hotel, Stripe, PokPay, each a row with connect, status (Connected, Incomplete, Test, Live), test, one on/off switch, switch account; hold minutes; refund defaults | Payments, payment cards of Integrations |
| Payments | **Clock payments** (Clock hotels only) | Where Clock records a website payment, what happens when the hotel cancels in Clock | Clock parts of Payments |
| Connections | **Property system** | Clock PMS+: connection, credentials, sync status (once), permissions; for native hotels a short "MUST is your property system" note | Clock card of Integrations |
| Connections | **Website** | WordPress connection code, website address (was "public website origin"), status | Website connection |
| Connections | **Restaurants** | The restaurant integration card | restaurant card in Integrations |
| Account (labelled "applies to all your hotels") | **Plan and usage** | Plan name, limits and usage; no disabled buttons | Billing account |
| Account | **Team and roles** (owner decision O1) | The Staff page moves here | sidebar Staff |

Emails stays a sidebar workspace only; the settings menu has a plain link to it and the Settings → Emails area is removed (old links redirect).

Removed: Coming-soon cards, integration category tabs, the disabled billing button, the duplicated contact fields, the read-only hold text, Settings → Emails, `IntegrationsManagement`, `@must/ui` use in Settings.

## Owner decisions

- **O1. Staff under Settings?** Recommendation: yes, as "Team and roles" (this is where Mews, Cloudbeds and most SaaS put user management; daily work does not need it in the main menu). Keep the sidebar item for one release as a link.
- **O2. Taxes and fees now or later?** Recommendation: add the area now with display-only settings (what the guest sees). For Clock hotels Clock keeps doing the invoicing; MUST must not compute invoices.
- **O3. Contact fields:** keep "reservations email" separate from the guest contact email? Recommendation: keep both, label them "Shown to guests" and "Receives booking notifications" so the difference is clear.

## Tasks for Sonnet (in this order, one PR each)

Rules for every task: follow AGENTS.md and the components-only rule (check `apps/web/components/ui` first, build anything missing there, pages only compose); old `settingsArea` links keep working through a redirect map; check every screen with a Clock hotel and a native hotel (Must Hotel locally); `pnpm -w lint`, `pnpm --filter web test` (full), `pnpm --filter api test` when the API changes, `pnpm -w build`; screenshot each changed page before and after and compare.

### R1. Clean-up with no visible change in behaviour (P9, P12)
- Move `credentialFieldsByProvider` to its own module; delete `IntegrationsManagement` and its test.
- Replace `@must/ui` in `settings.tsx` with `components/ui` (`ErrorPanel`, `ListSkeleton`, `Card`).
- Done when: no `@must/ui` import under the settings files and no reference to `IntegrationsManagement`.

### R2. Settings layout and side menu (P10)
- New shared `components/ui/settings-layout.tsx`: grouped side menu, mobile select, page title and description slot, sticky save bar slot.
- `settings-areas.ts` becomes the single source of groups, areas, labels, descriptions and the old-key redirect map (`general`→`profile`, `branding`→`contact-brand`, `check-in-out`→`policies`, `managed-pages`→`website`, `email`→Emails workspace, `integrations`→`payment-methods` or `property-system` by provider).
- The overview keeps only the readiness checklist; remove the card grid and the "Back to Settings overview" link.
- Done when: every area opens from the side menu in one click and old links land on the right new area.

### R3. Settings summary endpoint (P13)
- `GET /tenants/:t/properties/:p/settings-summary` returns each area's status and note (server port of `areaHealth`, plus connection state), used by the overview, the side menu badges and the Hotels directory.
- Done when: the overview makes one request; the Hotels directory uses the same endpoint; the browser `areaHealth` is deleted.

### R4. Property update split (P13)
- One shared column list constant in `properties.service.ts` (no 6 copies).
- Per-area update DTOs with validation (`profile`, `contact-brand`, `booking-rules`, `policies`, `payments`, `clock-payments`); the existing PATCH stays as a compatibility path for one release. Audit entries keep recording before and after per field.
- Done when: an invalid value in one area is refused with a field error from the API, and the audit log names the area.

### R5. Profile and Contact and brand (P3, P11, P15)
- Profile page as in the table; display currencies join the page's save bar.
- Contact and brand: `supportEmail` and `phone` edited here only, one label each; remove them from Profile.
- Done when: each field appears on exactly one page (a test asserts the field ids are unique across areas).

### R6. Booking rules and Policies (P4, P5, P15)
- Booking rules as in the table; "Inventory mode" becomes "How guests choose rooms".
- Policies page gathers every policy field from Check-in & check-out, Booking rules (house rules, free cancellation days), Payments (automatic refund, payment fee rule) and Branding (terms link), with one "Guests will read" preview built from the saved values.
- Remove the read-only hold text from Booking rules.
- Done when: Check-in & check-out no longer exists as an area and the preview matches what the booking page shows.

### R7. Payment methods owns the payment providers (P2, P7)
- API: `POST /tenants/:t/properties/:p/payment-connections` creates, tests and links in one server transaction; on failure nothing is saved. Same for credential replacement. (For Stripe, include the automatic webhook set-up from the Stripe plan T9 if built.)
- Web: one row per method with status, connect, test, on/off and switch account (test or live); the provider's on/off is the only switch. Labels: "Pay at hotel", "Card payment (Stripe)", "PokPay".
- Remove the payment cards from Integrations; the `paymentGateways` flags and the connection assignment stay in sync server-side (one source of truth, chosen in this task and written in a short ADR).
- Done when: a hotel can connect, test and switch on Stripe from one page, a failed test leaves nothing behind, and G-35 cannot happen again (test).

### R8. Clock payments, Property system, Website, Restaurants (P6, P15)
- Clock payments page (Clock hotels only): folio choice and cancellation rule, with plain-language hints ("Deposit folio: reception turns it into an advance invoice").
- Property system: Clock connection card, credentials, sync status shown once (the dialog becomes the page), permissions panel.
- Website: "Website address" instead of "Public website origin", connection code, connected state.
- Restaurants: its own area.
- Remove Coming-soon cards and category tabs; logos on one neutral background.
- Done when: the old Integrations area redirects and nothing on it is lost.

### R9. Plan and usage, Emails link, Team and roles (P1, P8, O1)
- Plan and usage: plan, limits, usage; no disabled button.
- Remove Settings → Emails; the side menu links to the Emails workspace.
- If O1 = yes: Team and roles renders the Staff page inside the settings layout.

### R10. Taxes and fees (P14, only after O2)
- Additive migration on `properties` (prices include VAT, VAT rate, city tax amount and unit), settings page, the booking page shows the total with mandatory taxes. Clock hotels: display only.

### R11. Wording pass
- Read every label, hint and empty state in the new areas aloud; short, plain, no internal terms (`origin`, `folio` without explanation, `inventory`, `managed pages`). Use the `design:ux-copy` checklist. Albanian strings follow the same keys if the dashboard is translated.

## Gaps fixed after the redesign ships

The scan of the designed tabs (Overview to Payment methods) found G-44 to G-65 in [hardening-gaps-log.md](../audit/hardening-gaps-log.md). Owner, 2026-11-17: ship the redesign first, then fix them one by one, the High ones first (G-46, G-44, G-45, G-52).
