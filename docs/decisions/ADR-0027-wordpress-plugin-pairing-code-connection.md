# ADR-0027: WordPress plugin connects via a short-lived pairing code, not manual UUID entry

Status: Accepted
Date: 2026-08-06

## Context

Per ADR-0016 (refined at Milestone 6 kickoff), the retrofitted WordPress plugin holds no PMS/payment credentials and authenticates as nothing — it stores only non-secret configuration (API base URL, tenant ID, property ID) typed directly into its settings screen. That decision is unchanged by this ADR.

In practice this configuration step doesn't work today: nothing in the platform's own dashboard (`apps/web`) displays a property's tenant ID or property ID anywhere. The only way to obtain them is an engineer querying the database directly. A real tenant self-serving a WordPress connection has no way to do this.

Separately, a Figma design for the plugin's admin experience (page "01 — Admin Dashboard", section "14 — WordPress Plugin") proposes a guided "First-Time Setup" wizard that pairs via an account email and a connection code (`MUST-SANUR-••••-••••`), rather than raw UUID entry. Reviewed and discussed with the owner (2026-08-06) against the current architecture — several other elements of that same Figma section (a local frontend cache, a periodic sync interval, multiple selectable "booking experience" modes, a customer-account "My bookings" page) conflict with decisions already made elsewhere and are explicitly out of scope for this ADR; see "Consequences" below.

## Decision

Replace manual UUID entry with a short-lived, single-use pairing code, generated from the platform dashboard and redeemed by the WordPress plugin:

1. **Generate** (dashboard, staff-authenticated): a Tenant Owner/Admin, from the property's settings, generates a pairing code for that property. The code is shown once, in the clear, and is never retrievable again — same handling as revealing an API key. It expires in 30 minutes. Format: `MUST-<property-slug>-XXXX-XXXX`, reusing the property's existing `slug` column so the code stays recognizable at a glance.
2. **Store**: the code is persisted **hashed**, alongside `tenant_id`, `property_id`, `expires_at`, and `redeemed_at` (null until used) — the same hygiene already used for other secrets in this codebase, not plaintext.
3. **Redeem** (WordPress, unauthenticated by necessity — the plugin's server has no staff session): `POST /wordpress-pairing/redeem` with `{ code }`. Validates the code exists, is unexpired, and is unredeemed; marks it redeemed on success (single-use, replay-proof) and returns `{ tenantId, propertyId, apiBaseUrl, propertyName }`. Rate-limited against brute-force guessing, reusing the existing signup-rate-limiter pattern. `apiBaseUrl` is resolved server-side from the platform's own configuration — one fewer value for anyone to type or mistype.
4. The plugin's settings screen becomes a single "Connection code" field plus a "Connect" button; on success it saves the resolved tenant ID/property ID/API URL exactly as it does today, and shows the resolved property name back for confirmation before finishing. A "enter connection details manually" fallback to today's raw 3-field form remains, for local dev or if pairing is ever unreachable — nothing existing is removed.

This is explicitly a UX/onboarding fix, not a security hardening measure: tenant and property IDs are not secret today (the guest-facing booking endpoints they scope are intentionally anonymous-reachable) and knowing them grants nothing beyond what any anonymous guest can already do on that property's public booking flow. The pairing code's value is removing the "go find a UUID somewhere" dead end, not closing an access-control gap.

## Consequences

- **New backend surface**: a `wordpress_pairing_codes` table, a generate endpoint (staff-authenticated, scoped to the property), and a redeem endpoint (public, rate-limited). No new durable credential is introduced anywhere — the code is discarded after one use, and what the plugin ends up storing is identical in kind to what it stores today.
- **The dashboard needs a "Connect WordPress site" UI** it does not have today — this ADR's generate step is also the first time tenant/property identifiers become visible anywhere in `apps/web` at all.
- **Explicitly deferred, not adopted**, from the same Figma section, each for its own reason:
  - A local WordPress-side cache with a periodic sync interval — conflicts with the standing "always live, no local mirror" architecture (guest-facing data is asked from the backend on every request, by design, to avoid a second source of truth). Not part of this or any near-term ADR.
  - Multiple selectable "booking experience" modes (full frontend / embedded / blocks & shortcodes / headless) — only the current fixed-pages model is built; the others (shortcode widgets in particular) resurrect dead code removed by the Milestone 6 retrofit and are a materially larger scope.
  - A "My bookings" customer-account page — implies persistent guest login, which doesn't exist; today's model is signed-link cancellation by email.
  - Brand/appearance customization (colors, button style, border radius) — ADR-0016 explicitly kept the legacy plugin's original CSS as-is; real theming is separate, undecided scope.
  - A Production/Staging environment toggle on the setup wizard — there is no staging API today, so the toggle would be a label with no behavior behind it.
- **Milestone 6's task table** gets new tasks for this work (kickoff-style breakdown to follow), since Milestone 6 already owns the plugin's connection/settings surface.

## Alternatives considered

- **Keep manual UUID entry, add a "Test connection" button** (validate + show the resolved property name before saving): smaller build, but doesn't solve the actual problem — there is still nowhere in the dashboard to obtain the UUIDs from. Rejected as insufficient on its own.
- **One-click deep link from the dashboard directly into WordPress admin** with the connection pre-filled: nicer than typing a code, but has a chicken-and-egg problem for first-time setup — the platform doesn't know the WordPress site's admin URL until a connection already exists once. Better suited to a later "reconnect" convenience, not adopted for initial pairing.
