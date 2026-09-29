# UI / UX audit

Evidence date: 2026-09-26. Owner-authorized audit exception to milestone scope; recommendations relate primarily to Milestones 13 and 14, with Clock remediation on the separately authorized Milestone 21 track. No product implementation or task-status changes are authorized by this report.

## Evidence boundary

This is a source-backed audit of the current dirty working tree, including existing uncommitted work. It is not a production inspection or a visual/accessibility certification. No provider, production, payment, WordPress installation, email, or deployment calls were made. No local app was launched against an unknown backend. Runtime claims below are explicitly limited to what source establishes; browser behavior, external Figma fidelity, contrast measurements, keyboard/screen-reader performance, mobile rendering and production installation versions remain unverified.

The root audit coordinates build/test execution. This report does not claim those checks passed until their results are supplied. Source-reading and text-search checks are not behavioral tests. All changes by this audit author are confined to this file. Existing root, Clock, documentation and plugin changes were preserved.

## Main assessment

The product has real staff, platform-admin and guest applications, a useful shared design foundation, and substantially more implementation than old milestone labels imply. The main usability risk is unreliable operational meaning: payment-return pages assert financial outcomes without verification, cancellation copy promises an uncalculated refund, staff date selection can create a different stay from the one the labels describe, and exceptions surface without a direct recovery route. Prioritize these ahead of matching more design frames.

Several designed areas are intentionally unavailable. Those are product-scope decisions, not automatically defects: Approvals, System Health and a separate Inventory screen are explicit placeholders. Existing Calendar blocking, custom role templates, capability overrides, reports and the notifications inbox must not be rebuilt merely because historical design comparisons call them absent.

## Application and screen inventory

Status vocabulary: Implemented = current code present, not necessarily accepted or runtime verified; Partial = meaningful flow present with material gaps; Planned = design/roadmap intent; Missing = no corresponding current UI found; Cannot determine = external/runtime evidence required.

| Screen / route or surface | Purpose and current implementation | Assessment and evidence |
| --- | --- | --- |
| `/` | Staff landing and signed-in redirect | Implemented; `apps/web/app/page.tsx`, `auth-routing.tsx`. Session lookup errors leave landing visible. |
| `/login` | Staff/platform sign-in and role routing | Implemented; `apps/web/app/login/page.tsx`. Shared auth shell, accessible input primitive and return-path restrictions. |
| `/signup` | Organization, first property and owner account on Free plan | Implemented; `apps/web/app/signup-form.tsx`. Four-field setup, busy state, minimum-length hint; no operational readiness checklist after signup in this form. |
| `/forgot-password`, `/reset-password` | Password recovery | Implemented; respective page files. Final session/reset behavior belongs to backend audit; browser/mail delivery unverified. |
| `/email-verification` | Verification status and resend | Implemented; corresponding page and shared `auth-status.tsx`. |
| `/staff-invitation`, `/staff-invitations` | Staff invitation acceptance and compatibility alias | Implemented; plural route re-exports singular implementation. |
| `/privacy`, `/terms` | Legal documents linked from auth shell | Documented but not implemented: both contain explicit placeholder text, MBA-217. |
| `/bookings/[bookingId]/payment/[outcome]` | Payment-return feedback | Partial and materially misleading; booking ID is not verified, MBA-200. |
| `/dashboard` | Tenant membership picker | Implemented; `tenant-picker.tsx`; fetch errors become false empty state, MBA-208. |
| `/dashboard/[tenantId]` | Property entry and common staff shell | Implemented; `property-entry.tsx`, `dashboard-shell.tsx`; URL carries property/section/tab scope, capability filtering exists. Unknown sections, denied sections and some errors render empty shell. |
| Dashboard / Overview | Arrivals, departures, in-house, occupancy and recent activity | Implemented; `overview.tsx`. Four plain metrics, no direct operational drill-down from counts/activity. |
| Dashboard / Needs Attention | Bookings requiring staff follow-up | Partial; `overview.tsx:153`. Lists statuses and guest/stay but no booking/action link, MBA-212. |
| Dashboard / Approvals, System Health | Designed operational work areas | Planned; explicit unavailable states in `dashboard-shell.tsx:143`. No underlying workflow certified. |
| Dashboard / Quick Booking | Staff walk-in booking and settlement | Partial; `walk-in-booking.tsx`. Room/type/rate, availability, quote, guest and gateway choices exist; date interpretation/recovery issues MBA-203/204. |
| Bookings (`section=reservations`) | Search/filter/sort booking list and detail | Implemented list, partial operational workspace; `reservations.tsx`. Guest/status/date filters; cancellation and payment actions; no date-amendment/check-in/check-out/room-change controls found. |
| Calendar | Nightly room-type availability; day arrivals/departures/in-house; manual blocks | Partial; `calendar.tsx`. Heavy request fan-out, new block absent from list until refetch, and read-only day drill-in. |
| Hotels | Accessible property summaries and property administration | Implemented; `HotelsSection` in `dashboard-shell.tsx`, `[tenantId]/property-management.tsx`; per-property overview fetches. |
| Inventory | Separate designed inventory area | Planned placeholder; blocking already exists under Calendar. Placeholder copy is not evidence that backend inventory is missing. |
| Payments | Booking-centric payment status, manual collection and fixed/percentage refunds | Partial; `payments.tsx`. Exact minor-unit subtraction for refund balance; lacks transaction ledger/search/pagination and a robust confirmation contract. |
| Guests | Guest search/history and suspected-duplicate review/merge/dismiss | Implemented; `guests.tsx`. Strong domain workflow exists; all-bookings download, stale selected/history state after merge and weak links limit use. |
| Staff | Invitations, role-template creation/assignment and capability overrides | Implemented; `staff.tsx`. Not just hard-coded personas; not a full invitation/session/access-management console. |
| Reports | Occupancy, bookings-created, net succeeded charges/refunds and cancellation rate | Implemented foundation; `reports.tsx`. Dates, separate currencies and accessible HTML data tables accompany charts. ADR/RevPAR/source/aging reports are not present here. |
| Settings hub | Grouped configuration navigation | Implemented; `settings.tsx`. Hotel identity, email branding, booking rules/mode, payment methods, WordPress pairing and billing view. |
| Settings / integrations | Tenant-owned credentials, test/delete, property assignments, Clock sync/mapping/policies | Implemented substantial configuration; `[tenantId]/integrations-management.tsx`. Provider status/failed jobs/conflict/recovery console remains partial/missing. |
| Notifications bell/inbox | Read/unread booking/payment/seat alerts | Partial; `notifications.tsx`. Paginated inbox exists, but unread count is wrong after 20 records and payload is not actionable, MBA-210/212. |
| `/platform` | Cross-tenant summary | Implemented; `platform/page.tsx`; separate platform audience guard. |
| `/platform/tenants` | Tenant search and listing | Implemented; `platform/tenants/page.tsx`. Platform controls do not imply general tenant impersonation. |
| `/platform/tenants/[tenantId]` | Tenant/user/property/integration oversight and targeted actions | Implemented; corresponding page. Suspend/reactivate and password reset are powerful support operations; failed queue/root-cause workflows remain limited. |
| `/platform/audit` | Paginated platform audit history | Implemented; `platform/audit/page.tsx`. No general guest-payment or operational notification console inferred from its existence. |
| Not found / global error | Unknown route and fatal app error recovery | Implemented; `not-found.tsx`, `global-error.tsx`; not a substitute for section-level invalid/denied states. |
| WordPress booking page / search widget | Dates and occupancy selection | Implemented; `src/Frontend/booking-page.php`, `assets/js/booking-page.js`, booking template and Elementor widget. Current funnel is one room at a time. |
| WordPress accommodation page | Room/type/rate choice and quote | Implemented; `accommodation-page.php`, template/JS. Uses authoritative API quote; selection in session-keyed WordPress transient. |
| WordPress single-room and room widgets | Room presentation, amenities and booking entry | Implemented; `single-room-page.php`, Elementor room widgets, corresponding assets. Current theme/mobile appearance unverified. |
| WordPress checkout / Guest Information | Collect guest/contact/special requests | Implemented; `checkout-page.php`, checkout template and phone field JS. Repeated guest/billing fields on next step increase friction. |
| WordPress Review & Payment | Review, billing details, payment choice and booking POST | Partial; `confirmation-page.php`, booking-confirmation template. Stable idempotency and policy disclosure need correction. |
| WordPress confirmation/post-booking/cancellation | Authoritative booking lookup, pending polling, guest cancellation | Partial; lifecycle branches and refund promise defects MBA-201/202; no guest self-service amendments found. |
| WordPress settings | Code pairing, manual configuration and calendar style | Implemented; `src/Admin/SettingsPage.php`. Nonce and `manage_options` enforced; connected indicator checks IDs, not actual reachability. |
| WordPress update/activation | Distribution ZIP self-update and managed pages | Implemented with compatibility/residue concerns; `Core/Updater.php`, `Core/Plugin.php`, release workflow. Installed versions and update success cannot be determined. |

## Verified findings

### MBA-200 — Payment-return route asserts an outcome from the URL

- Category / severity / area: Financial UX correctness / **High** / Next.js payment return.
- Evidence: `apps/web/app/bookings/[bookingId]/payment/[outcome]/page.tsx:15`, `:35`, `:46`, `:52`, `:17`.
- Current behavior: Every outcome other than literal `cancel` displays “PAYMENT RECEIVED”; cancellation says the guest was not charged. The component never fetches a payment/booking record and redirects to `/dashboard` after five seconds.
- Problem: An arbitrary or delayed return URL cannot establish receipt or absence of a charge. The visible result can contradict a pending/failed/late provider event.
- Impact: Guest/staff trust, duplicate payment attempts and support disputes. This finding is about false UI assurance, not a demonstrated server-side settlement bypass.
- Recommendation: Validate outcome vocabulary; retrieve authoritative guest/staff-scoped status; show processing/unknown with retry and booking-specific recovery. Retain unresolved states until verification; preserve tenant/property context for staff and guest-safe destination for guests.
- Effort / timing / dependencies: M / before real payments / public booking projection and return-link ownership.
- Status: Open; source verified, provider/browser reproduction not performed.

### MBA-201 — Guest cancellation promises a refund it has not calculated

- Category / severity / area: Financial disclosure / **High** / WordPress cancellation.
- Evidence: `apps/wordpress-plugin/src/Frontend/confirmation-page.php:170`, `:172`; `apps/wordpress-plugin/frontend/templates/booking-confirmation.php:312`.
- Current behavior: CONFIRMED/PAYMENT_PENDING status plus a cancellation query action creates `eligible=true`, `execution_ready=true`, and `paid_amount=totalPrice`. The template says the guest will receive a full refund minus a processing fee.
- Problem: This does not inspect authoritative cancellation snapshot, settled amount, previous refunds or processing-fee rule. Pay-at-hotel and pending bookings can have no paid amount at all. The preparation and execution POST branches both call DELETE rather than calculating a preview.
- Impact: Incorrect refund expectations and materially uninformed cancellation decisions.
- Recommendation: Return an authoritative cancellation-impact preview with eligibility, deadline/timezone, paid/refundable/retained amounts and currency. Show confirmed consequences and separately track cancellation versus refund execution. Do not invent a fee policy.
- Effort / timing / dependencies: M-L / before guest cancellation launch / backend cancellation/refund contract and approved hotel policy.
- Status: Open; confirmed source mismatch, actual provider refund not exercised.

### MBA-202 — Guest status UI cannot resolve the full booking lifecycle

- Category / severity / area: Recovery / **High** / WordPress confirmation.
- Evidence: `apps/wordpress-plugin/src/Frontend/confirmation-page.php:164`, `:190`; `apps/wordpress-plugin/assets/js/booking-confirmation.js:52`, `:91`.
- Current behavior: PHP gives dedicated copy only for CONFIRMED, PAYMENT_PENDING and CANCELLED; polling starts only for PAYMENT_PENDING. JS recognizes only CONFIRMED/CANCELLED and silently stops after 60 seconds. Errors are swallowed until that timeout.
- Problem: EXPIRED, PAYMENT_FAILED, PMS_CONFIRMATION_PENDING and MANUAL_REVIEW can remain “Checking your booking status” or processing without an actionable outcome. A cancellation-token email opened in a new browser can load initial details, but polling does not relay that token.
- Impact: Abandonment, repeat bookings, support calls and guests arriving without understood reservation status.
- Recommendation: Define guest-safe copy and recovery for every state, separate payment from PMS fulfillment, preserve authorized polling context, and show timed-out/retry/contact-hotel states with a booking reference.
- Effort / timing / dependencies: M / before launch / full state projection and privacy-safe guest authorization.
- Status: Open; source verified.

### MBA-203 — Staff date labels disagree with the submitted stay

- Category / severity / area: Reservation correctness / **High** / Quick Booking and blocking.
- Evidence: `apps/web/app/dashboard/walk-in-booking.tsx:201`, `:205`, `:409`, `:424`; `apps/web/app/dashboard/calendar.tsx:171`, `:294`.
- Current behavior: Quick Booking tells staff to choose check-in/check-out, but treats the second date as the last occupied night and adds one day. Both range pickers specify `min={1}` while treating the endpoints as inclusive occupied nights.
- Problem: Selecting apparent arrival and departure can submit an additional night. The minimum range is also inconsistent with the intended ability to select a single occupied night; this must be verified against the installed picker behavior.
- Impact: Wrong stay length, price, inventory consumption and operational dates.
- Recommendation: Use explicit arrival/departure half-open dates for booking; independently define inclusive unavailable-night selection for blocks. Verify one-night, month-boundary, DST and unavailable-checkout-day cases against the real component.
- Effort / timing / dependencies: S-M / immediate / agreed stay-date interaction contract.
- Status: Open; label/payload mismatch source verified; single-night picker effect requires behavioral confirmation.

### MBA-204 — Client retries create new booking intent keys

- Category / severity / area: Reliability and booking UX / **High** / Guest and staff creation.
- Evidence: `apps/wordpress-plugin/src/Frontend/confirmation-page.php:291`; `apps/web/app/dashboard/walk-in-booking.tsx:158`, `:163`, `:169`, `:190`.
- Current behavior: Each guest POST uses a fresh UUID. Staff creation also allocates a fresh key per mutation and combines booking creation and manual settlement in one UI action. Popup checkout opens only after an awaited request, and its return value is not checked.
- Problem: A transport timeout or a successful create followed by settlement failure does not preserve a recoverable booking ID/intent. Retrying can create another reservation. A blocked popup loses the only visible checkout handoff while success copy says a window opened.
- Impact: Duplicate pending/confirmed reservations, stranded inventory or lost checkout and collection attempts. Backend idempotency by supplied key does not deduplicate different keys.
- Recommendation: Persist a stable intent key through retries, retain created booking ID before settlement, reconcile ambiguous responses, and present a durable checkout link and separate retry-settlement action. Clear intent only after terminal acknowledgment or deliberate new booking.
- Effort / timing / dependencies: M / before real booking traffic / backend operation lookup/idempotency retention and payment recovery contract.
- Status: Open; source verified; no duplicate created during audit.

### MBA-205 — Calendar performs one request per room type per day

- Category / severity / area: Performance and failure amplification / **Medium** / Calendar.
- Evidence: `apps/web/app/dashboard/calendar.tsx:428`, `:444`, `:445`.
- Current behavior: A nested `Promise.all` loads availability independently for every room type and day, plus room lists and full booking history.
- Problem: Ten types in a 31-day month require 310 availability requests; one failure rejects the entire batch. Month navigation/revisiting magnifies load.
- Impact: Slow mobile rendering, rate-limit pressure, backend/database load and all-or-nothing calendar availability.
- Recommendation: Add a bounded property/month range projection with explicit partial/error/freshness semantics; query only relevant booking ranges. Measure using representative inventory sizes before selecting cache policy.
- Effort / timing / dependencies: M / before broad hotel rollout / backend bulk availability contract.
- Status: Open; request cardinality source verified; no load benchmark run.

### MBA-206 — Newly created blocks do not refresh the visible block list

- Category / severity / area: State consistency / **Medium** / Calendar.
- Evidence: `apps/web/app/dashboard/calendar.tsx:124`, `:129`, `:148`, `:372`.
- Current behavior: Create success invalidates availability only. Existing blocks render a separate `availability-blocks` query. Delete success correctly invalidates both.
- Problem: After creating a block, staff can see reduced availability while the block list still says there are no blocks or omits the newly created one.
- Impact: Confusion, repeated blocking and inability to immediately locate/remove a mistaken block.
- Recommendation: Invalidate or update both query families after creation; add a behavioral create/list/remove test in the same rendered session.
- Effort / timing / dependencies: S / immediate / none beyond local UI contract.
- Status: Open; source verified.

### MBA-207 — Plugin advertises PHP 7.4 while unconditionally loading PHP 8 syntax

- Category / severity / area: Compatibility and release integrity / **High** / WordPress.
- Evidence: `apps/wordpress-plugin/must-hotel-booking.php:9`; `apps/wordpress-plugin/includes/config.php:33`, `:67`; `apps/wordpress-plugin/src/Frontend/confirmation-page.php:164`.
- Current behavior: Plugin header permits PHP 7.4; loader includes lowercase frontend PHP files on bootstrap; confirmation source contains a `match` expression.
- Problem: PHP 7.4 cannot parse that file. A site meeting the advertised minimum can fail on plugin load, not merely when opening checkout.
- Impact: Plugin activation/update can break the WordPress request path for affected sites.
- Recommendation: Approve and align a supported PHP minimum or remove incompatible syntax; test packaged ZIP activation and upgrade on every advertised PHP/WordPress combination. Correct header/readme/documentation together.
- Effort / timing / dependencies: S-M / before next release / support-policy decision and CI compatibility matrix.
- Status: Open; static parse incompatibility established; no PHP 7.4 runtime invoked.

### MBA-208 — Entry and authorization failures masquerade as empty or blank screens

- Category / severity / area: Error recovery / **Medium** / Staff shell.
- Evidence: `apps/web/app/dashboard/property-entry.tsx:15`, `:28`; `apps/web/app/dashboard/tenant-picker.tsx:14`; `apps/web/app/dashboard/dashboard-shell.tsx:281`, `:310`, `:386`.
- Current behavior: Failed property/membership requests become empty arrays; shell catch sets null user/empty properties. The render tree contains positive conditions for recognized authorized sections without matching forbidden/unknown/loading/error panels.
- Problem: Outage, session expiry, permission denial, a real empty tenant and malformed `section` are indistinguishable or result in a blank main area.
- Impact: Users may assume their hotels/bookings disappeared; no clear retry or route recovery.
- Recommendation: Preserve typed request outcomes, redirect actual expired sessions, render forbidden/not-found/loading/empty/error states and expose safe retry. Share property loading instead of fetching it in entry and shell separately.
- Effort / timing / dependencies: M / next reliability pass / shared API error contract.
- Status: Open; source verified.

### MBA-209 — Modal semantics are declared without modal keyboard behavior

- Category / severity / area: Accessibility / **Medium** / Mobile navigation and refund dialog.
- Evidence: `packages/ui/src/components.tsx:404`, `:447`; `apps/web/app/dashboard/payments.tsx:284`.
- Current behavior: Navigation uses `aria-modal=true`, focuses its first link and handles Escape, but has no focus trap or inert background. Refund uses a dialog section with Escape handler but no automatic focus transfer, trap or focus restoration. The account menu advertises menu semantics without corresponding arrow-key/Escape focus management.
- Problem: Declared modal/menu behavior does not match keyboard interaction; users can move behind a modal or fail to discover it.
- Impact: Material keyboard/screen-reader barriers, especially in financial actions. This is not a complete WCAG failure inventory or conformance determination.
- Recommendation: Introduce tested shared dialog/menu primitives; trap/restore focus and inert the background appropriately; verify actual keyboard and screen-reader sequences at mobile and desktop sizes.
- Effort / timing / dependencies: M / before accessibility acceptance / Milestone 13 interaction contract.
- Status: Open; missing behavior source verified; assistive-technology/browser validation outstanding.

### MBA-210 — Notification badge labels total history as unread count

- Category / severity / area: Operational signal accuracy / **Medium** / Notifications.
- Evidence: `apps/web/app/dashboard/notifications.tsx:106`, `:108`, `:119`.
- Current behavior: If the result has more than 20 total records, the badge is `20+` regardless of whether any are unread; its accessible label says “unread”. Otherwise it counts unread only on the first page.
- Problem: Read history and unseen count are different quantities. Marking everything read does not clear a >20-record badge.
- Impact: Alert fatigue and reduced trust in critical attention signals.
- Recommendation: Provide authoritative unread count independent of paginated history, update it atomically after read actions, and test all-read history above page size.
- Effort / timing / dependencies: S-M / next UI corrective pass / notification API count.
- Status: Open; source verified.

## Strengths to preserve

- Staff/platform audiences are explicitly separated; tenant and property are encoded in routes and query keys, and navigation consults role/capability data. These UI checks complement, rather than establish, backend security.
- Shared `TextInput` links labels, hints and errors; shell has a skip link, readable text status badges, responsive navigation tiers, reduced-motion styling and explicit unavailable/empty/error/loading vocabulary.
- Guest booking calls the MUST backend through a same-origin WordPress server relay; session cookies are HTTP-only, idempotency headers are supported, provider secrets are not needed in guest JS, and normal quote/creation authority resides in the API.
- Reports show different currencies separately and provide HTML data tables alongside ECharts. Refund remaining-balance subtraction uses integer minor units.
- Settings pairing enforces WordPress nonces and `manage_options`; malformed UUID/manual connection input is validated. Guest templates consistently use escaping functions in inspected dynamic markup.
- Room selection has both AJAX and normal form fallback, occupancy/capacity validation and a final quote. Duplicate-guest review exists and lets staff pick the canonical record instead of silent automatic phone-based merging.

## Coverage and remaining verification

Read current root/plugin agent instructions, root documentation router, ADR/roadmap indexes, `docs/architecture/frontends-and-api.md`, and `docs/design/design-system.md`. Read active Milestone 13 and completed 6/7/9 via targeted/chunked inspection; their very long historical task rows are not yet fully covered. Historical WordPress archive full-content review is still pending. `apps/wordpress-plugin/docs/README.md` does not exist: the current compatibility pointer is `docs/INDEX.md`, as the plugin agent instructions state.

Source coverage includes all real Next route families, the common shell/primitives, principal dashboard workflows, WordPress bootstrap/config/client, guest selection/details/review/status/cancellation and settings/update code. Additional source review, findings and exact reference verification will be appended during this audit. No claim of complete browser/production/source-line coverage is made.
