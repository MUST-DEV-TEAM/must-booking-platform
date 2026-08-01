# UI and UX Contract

This document defines current interface structure and non-regression rules. Lifecycle truth belongs in [DOMAIN_LIFECYCLES.md](DOMAIN_LIFECYCLES.md); routes and module ownership belong in [ARCHITECTURE.md](ARCHITECTURE.md).

## Surface map

| Surface | Current contract |
|---|---|
| `/rooms` | Optional assigned catalogue/Elementor host; not automatically required. |
| `/booking` | Dates, guests, room count/category; one- or two-calendar configuration. |
| `/booking-accommodation` | Room/rate selection; omitted by fixed-room entry flows. |
| `/checkout` | Guest/contact/billing details, room allocation, coupon, and stay review. |
| `/booking-confirmation` | Review/payment, provider return, pending/success/failure result, and guest cancellation review. |
| `/staff-login` | Nonce-protected WordPress authentication plus staff-role/disabled-user checks. |
| `/staff` | Capability- and module-visibility-gated hotel operations shell. |
| WordPress admin | Administrator operations, configuration, diagnostics, content, reservations, and money workspaces. |
| Elementor | Booking Search, Rooms List, and Rooms Text Grid widgets. |
| Clock WBE Inline | Optional embedded Clock UI that redirects away from plugin booking/accommodation/checkout pages. |

No separate logged-in customer dashboard was found. Guest-facing booking data is exposed through the checkout/confirmation/cancellation flow and must be protected accordingly.

## Public booking flow

Normal sequence:

1. Calendar/search
2. Select accommodation
3. Guest details
4. Review and payment

A fixed-room flow starts from a known physical room and skips the general selection step. Managed page IDs, fallback slugs, query parameters, and selection transient fields are compatibility contracts; they are navigation state, not authoritative price, inventory, payment, or ownership evidence.

### Calendar and availability

- Validate check-in before check-out and preserve configured minimum/maximum stay and advance-booking rules.
- Disabled/unavailable dates must remain visibly unavailable while selecting a range; hover or range styling must not make them look selectable.
- Selected, in-range, today, unavailable, restriction, loading, and error states must remain visually distinguishable.
- One-calendar/two-calendar and responsive layouts must produce the same server-submitted dates.
- Party size, room count, category, and fixed-room context must survive valid navigation and reset when incompatible dates/context change.
- The server rechecks locks, availability, pricing, and provider state regardless of what the calendar displayed.

### Accommodation selection

- Cards/listings must show a stable name, capacity, availability/rate state, policy/price summary, and a clear selection action.
- Multiple rooms must expose room-level guest allocation and selected rate plan without implying one physical room can hold overlapping stays.
- Lock expiry, stale availability, quote change, and capacity mismatch return the guest to an actionable state; they must not silently choose another rate/room.
- Loading and no-result views must be distinct from provider/configuration failures.

### Checkout forms

- Required guest, contact, country, billing, consent, special-request, room-guest, coupon, and payment inputs are validated server-side.
- Inline errors should identify the field and preserve non-secret valid input.
- Prevent duplicate submits while a request/redirect is in progress, but do not rely on the disabled button for idempotency.
- Never repopulate secrets or expose provider diagnostics to guests.
- The final CTA must reflect the selected enabled method: Stripe/PokPay payment, or explicit pay-at-hotel confirmation.

### Payment and result presentation

- `pending_payment` is shown as processing, not success.
- `expired` and `payment_failed` provide a retry/restart path without claiming the room remains held.
- Online confirmed/paid copy is used only after authoritative provider verification and required Clock fulfillment.
- Pay-at-hotel copy states that the booking is confirmed and payment will be collected at the property.
- Browser return/callback parameters never override server-derived status.
- Manual review, provider-unavailable, and ambiguous outcomes must remain warnings/pending states, not green success notices.

### Confirmation/cancellation access contract

The confirmation surface requires an opaque, hashed, expiring grant scoped to the exact reservation set and exchanges it for a per-tab cookie-backed context. Numeric reservation/booking identifiers and PokPay browser return parameters are not authorization. Cancellation execution uses a separate short-lived purpose and is atomically consumed before mutation.

Any redesign must preserve these server-side ownership, purpose, expiry, and one-time execution boundaries; visual concealment is not authorization.

## WordPress admin information architecture

Visible plugin pages include:

- Dashboard
- Reservations
- Provider Logs
- Calendar
- Accommodations
- Rates & Pricing
- Availability Rules
- Payments
- Emails
- Guests
- Coupons
- Reports
- Settings

Hidden/internal routes include reservation detail, add reservation, rate plans, and taxes/fees. Most operational pages require `manage_options`; Settings can use the configured plugin-settings capability with administrator override.

### Admin contracts

- Preserve menu/page slugs, filters, pagination, sort/search state, action URLs, nonces, and capability checks.
- Reuse established card, table, filter, tab, badge, notice, empty-state, and button patterns.
- Reservation status, payment status, amount paid/due/refunded, provider sync, and manual review must have separate labels.
- Provider-backed actions route through provider/lifecycle policies. A skipped or ambiguous provider action must not display success.
- Reservation detail must retain guest/stay/payment/provider/activity correlation without exposing secrets.
- Destructive actions require explicit confirmation and clear scope; reset tooling is not a convenience control.

## Staff portal

Modules:

- Dashboard
- Reservations
- Calendar
- Front Desk
- Guests
- Payments
- Housekeeping
- Rooms & Availability
- Reports

Visibility depends on both module settings and current-user capabilities. Current staff roles include Front Desk Agent, Front Office Supervisor, Housekeeping, Finance/Cashier, and Operations Manager. Preserve `/staff`, `/staff-login`, public capability names, role aliases, disabled-user checks, logout behavior, and post-login redirects.

Deprecated module routes remain compatibility redirects:

- `quick-booking` -> Front Desk / new booking
- `accommodations` -> Rooms & Availability / rooms
- `availability-rules` -> Rooms & Availability / rules

Do not delete the old route handling or templates solely because navigation no longer links to them; verify redirect/render usage first.

### Portal interaction rules

- Dashboard counts/action cards must respect the viewer's modules and permissions.
- Front Desk creation must preserve fixed-room/date/guest/payment validation and Clock provider readiness.
- Cancellation request, supervisor approval/rejection, direct cancellation, check-in, check-out, completion, room move, payment recording, and housekeeping are separate actions.
- Disabled modules/actions must not be recoverable by changing the URL or POST field.
- On narrow screens, navigation, filters, tables, primary actions, notices, and detail data must remain operable.

## Elementor and theme compatibility

Active widget names/classes cover Booking Search, Rooms List, and Rooms Text Grid. Uppercase widget class files and lowercase registration/asset modules are both active compatibility components.

- Booking Search can link to a selected Rooms List widget; preserve widget/document IDs and legacy connection settings.
- Widgets reuse managed booking URLs and plugin assets; they do not own domain behavior.
- Respect configured inheritance of Elementor global colors and typography.
- Do not assume Hello Elementor is the only host theme.
- Avoid global element resets and selectors such as unscoped `button`, `input`, `table`, `a`, headings, or generic utility class names.

## Styling conventions

Primary scopes include:

- `.must-hotel-booking-page`
- `.must-booking-process-page`
- `.must-hotel-booking-*`
- `.must-booking-*`
- `.must-portal-*`
- plugin-specific WordPress admin body/wrapper classes

Public flow, portal, and admin have related but separate style systems. Use existing CSS variables/tokens, spacing, radii, borders, colors, typography, cards, tables, badges, notices, and buttons before adding a new pattern. Keep branding overrides within the relevant wrapper.

## State vocabulary

Every asynchronous or data-driven component needs a truthful state:

| State | UX requirement |
|---|---|
| Loading | Show bounded progress and prevent accidental duplicate action. |
| Empty | Explain that no records/results exist; do not display a generic error. |
| Unavailable | Make the item/date non-actionable and explain when useful. |
| Selected | Preserve a clear selection affordance and remove/change action. |
| Pending | Avoid success language; say what is being verified. |
| Success | Use only after the server confirms the required lifecycle result. |
| Warning/manual review | Expose the unresolved owner and safe next action. |
| Error | Give a recoverable step without leaking provider internals. |
| Capability denied | Do not render protected data or action forms. |

## Accessibility

- Preserve semantic labels, fieldsets/groups, table headings, buttons/links, `aria-label`, `aria-current`, and decorative-image handling.
- Errors should be associated with their inputs and summarized/focused when submission fails.
- Modals/lightboxes need keyboard entry/escape, focus trapping where appropriate, and focus return.
- Dynamic loading/payment/error messages should be announced without stealing focus repeatedly.
- Branding and state colors must meet usable contrast; do not rely on color alone.
- Touch targets and mobile controls must remain usable at supported responsive breakpoints.

Current defect: `assets/css/pages/booking-page.css` removes focus outlines/box shadows from focused controls across the managed flow. New work must restore an intentional visible focus indicator and verify keyboard navigation; do not perpetuate the suppression.

## JavaScript contract

- Scope scripts to the current plugin surface and localized server configuration.
- Avoid new globals and cross-page event listeners.
- Treat client validation as assistance only; the server owns validation and authorization.
- Prevent accidental double submission, tolerate back/forward navigation, and render server fallbacks truthfully.
- Keep query strings, transients, and DOM data free of secrets and unnecessary personal data.
- Do not make provider credential probes or provider writes during passive rendering.

## Responsive and compatibility verification

### Public

Test normal and fixed-room flow, one/two-calendar modes, multiple rooms, no availability, lock expiry, stale quote, changed policy/price, provider pending/failure/success, pay at hotel, and cancellation at desktop/tablet/phone widths.

### Admin

Test every menu/detail route, filters/pagination, empty/large tables, nonce failure, capability denial, provider-backed action restrictions, diagnostics, and responsive action access.

### Portal

Test each role/module, disabled account, hidden module, deprecated redirects, login/logout, mobile navigation, action confirmation, and truthful provider errors.

### Elementor/theme

Test editor and live rendering, linked widgets, absent optional Rooms page, global style inheritance on/off, active theme templates, and plugin asset loading.

Browser, theme, Elementor, keyboard, and screen-reader acceptance were not executed during this consolidation and remain unverified.
