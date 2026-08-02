# ADR-0024: Identity and contact-profile fields for User, Organization, Property, and Guest

Status: Accepted
Date: 2026-08-02

## Context

Milestone 9 kickoff needed a guest-name field that turned out not to exist anywhere in the schema (`Guest` had no `firstName`/`lastName`, and neither did `Booking` — the name submitted at booking time was used transiently for a confirmation email and discarded). Fixing that one gap surfaced a broader question the owner wanted settled properly rather than patched field-by-field: what identity/contact fields should each entity in the system actually have, long-term, even if most of them aren't built yet.

An audit of the schema found: nobody who logs into the system — platform admin or tenant staff, both are the same `User` table — has a name, phone, or any preference field anywhere; `Organization` has no contact info of its own (the Owner's personal email is the only de facto contact); `Property` has no phone/contact-email; `Guest`'s address has no country. No i18n infrastructure exists anywhere in the codebase.

Brainstormed with the owner, entity by entity, including a real architectural question: should Platform Admin / Tenant Owner-Admin / Tenant Staff have different profile field sets, given they're conceptually different "kinds" of user? Resolved by precedent from GitHub, Slack, and Stripe: systems split into a separate table/model when user types are genuinely different *kinds of entities* with substantially different data needs (Stripe's dashboard User vs. Connect Account, or this project's own existing `User` vs. `Organization` split). When different types are the same underlying thing — a person who logs in — differentiated only by *role/permissions*, one shared table is the correct, standard pattern (GitHub's org-role, Slack's workspace-role). Platform Admin, Tenant Owner, Tenant Admin, and Tenant Staff are the latter case: already differentiated by `User.isPlatformAdmin` + `TenantMembership.role` + the capability system, not by any need for different profile data.

The owner also provided a screenshot of the legacy plugin's real guest-booking form, used as concrete reference for `Guest`'s target fields.

## Decision

**`User`** (one shared field set — covers Platform Admin, Tenant Owner, Tenant Admin, and Tenant Staff uniformly; role/capability system remains the only differentiator, not a different profile shape):
- `firstName`, `lastName`
- `phone` — structured (see Phone format below), not free-text
- `jobTitle` — free-text display label (e.g. "Front Desk Manager"), distinct from the `TenantMembershipRole` enum and the capability-based role-template system; purely cosmetic, never used for authorization
- `preferredLanguage`
- `preferredDateTimeFormat`
- `personalTimezone` — distinct from `Property.timezone` (that's the property's own operational timezone; this is which timezone timestamps are displayed in for this person)

**`Organization`**:
- `contactEmail`, `contactPhone` (structured) — a stable business contact point independent of which individual holds the Owner account
- `billingAddress` (street, city, postcode, country)
- `taxId` (VAT number)

Note: `billingAddress`/`taxId` conceptually belong on `Organization`, but actually collecting/editing them is likely Milestone 11 (Platform Billing)'s job, not something built as part of this ADR's own follow-up work — this decision fixes where the fields live, not when they get built.

**`Property`**:
- `phone`, `contactEmail` (structured phone) — the property's own guest-facing contact info, distinct from the organization's business contact

**`Guest`** (per the legacy form screenshot, plus the country gap already identified):
- `companyName` (optional) — the screenshot shows this for guests booking on behalf of a business
- `country` — one field only (the screenshot's apparent second "Country of Residence" field was a form-layout artifact, not two distinct concepts; a guest's mailing-address country and residence country aren't meaningfully different for this system's purposes)
- `phone` migrates from free-text to structured, same shape as everywhere else
- (already has, or has in flight via Milestone 9 Task 6: `firstName`, `lastName`, `email`, `streetAddress`, `addressLine2`, `city`, `county`, `postcode`)

**Phone format, decided once for consistency across all four entities**: two columns, `phoneCountryCode` (dial code, e.g. `+355`) and `phoneNumber` (the national number as entered) — not a single pre-formatted E.164 string. This matches the screenshot's actual UI pattern (a country/flag picker paired with a separate number input) without needing to parse a combined string apart every time the UI redisplays the picker.

## Consequences

- Every field in this ADR is additive and nullable — no breaking changes, no forced backfill for existing rows. Existing `User`/`Organization`/`Property` rows simply have no name/contact info until someone fills it in; existing `Guest.phone` (currently free-text) needs a migration to the two-column structured shape, which will require a data-shape decision for already-stored values (e.g. best-effort parse, or leave both columns null and let it be re-collected) when that specific migration is actually scheduled.
- `preferredLanguage`/`preferredDateTimeFormat` are genuinely inert once added — storing them costs nothing, but they don't *do* anything until real i18n infrastructure exists (translating every UI string and email template). That's a separate, much larger future effort and is explicitly not scoped by this ADR.
- This ADR fixes the *target shape* of each entity. It does not schedule when each field gets built — that happens task-by-task, milestone-by-milestone, the same way `Guest.firstName`/`lastName` is being scheduled as part of Milestone 9 Task 6 right now. Some fields here may not be built for a long time; that's expected and fine.
- The "one shared `User` table" decision means if a genuinely role-specific field emerges later (something that would be actively wrong to show on the wrong role, not just usually-unused), it gets added as a small nullable extension at that time — this ADR doesn't need revisiting for that, it's consistent with the pattern already decided here.

## Alternatives considered

- **Separate profile tables/extensions per role** (Platform Admin profile, Tenant Admin profile, Tenant Staff profile): rejected. None of the fields decided here are role-specific in nature — a platform admin has a name and a phone number exactly the same as a tenant staff member does. This would add real modeling complexity (polymorphic joins, three profile-edit UIs instead of one) for no concrete benefit, and diverges from how the rest of this system already differentiates user types (role/capability, not table shape).
- **Free-text phone everywhere**: rejected in favor of structured (country code + number) for consistency and future validation/formatting benefits, matching what the legacy guest form already does.
- **Two distinct guest country concepts** (residence vs. address): rejected as unnecessary complexity with no concrete driving use case identified.
