# Security, access and database audit

Audit date: 2026-09-26. Working-tree source audit authorized by the owner outside the active milestone task table; no product changes. Findings below describe checked-in behavior, not a live penetration test or deployed-configuration certification. Existing user edits are preserved. This report owns MBA-100 through MBA-199; the main finding register links to these entries.

## Scope and progress

Read: repository AGENTS, docs router, data/access architecture, roadmap index, all ADRs 0001–0031 and completed milestones 1, 2 and 8. Source review in progress: authentication, guards, capabilities, tenancy, platform administration, schema/migrations, integration credential handling and media. No external-provider or production requests performed.

## MBA-100 — Tenant suspension does not enforce an access boundary

- Category: Security / Product
- Severity: HIGH provisional, conditional on suspension being an operational access control
- Affected area: platform suspension; authenticated and guest APIs
- Evidence: `apps/api/src/platform/platform-admin.service.ts:270`, `:309`; `apps/api/src/tenancy/tenant-context.guard.ts:64`; `apps/api/src/tenancy/public-tenant-scoped.guard.ts:31`; `apps/api/src/tenancy/roles.guard.ts:47`; `docs/decisions/ADR-0021-platform-admin-cross-tenant-data-access.md:12`. Challenge: [MBA-AUDIT-014](investigations/MBA-AUDIT-014.md).
- Current behavior: the platform action conditionally persists and audits organizations.status in one transaction. Staff/public admission guards and capability checks do not consult SUSPENDED; eligible requests can proceed to ordinary downstream authorization, rate, quote and booking checks.
- Problem: suspension is currently an administrative marker at these entry gates. ADR-0021 authorizes the action but does not define which operations must stop, so missing enforcement is verified source behavior while a violation of the intended suspension contract remains a QUESTION.
- Impact: if operators rely on suspension to stop staff access or new guest activity, these paths do not provide that control. No successful suspended-tenant booking, deployed exposure or incident-containment failure was demonstrated.
- Counterevidence: the state transition and audit are real; platform authorization and expected-state predicates apply. Existing route checks still apply after suspension. Historical tests establish status/audit behavior, not an admission boundary.
- Recommendation: settle the allowed/blocked operation policy in [QUESTIONS](QUESTIONS.md), including existing/fresh sessions, new bookings, refunds, callbacks, reconciliation and workers; then implement and test the agreed boundary while preserving financial recovery.
- Effort: M
- Timing: NOW for policy clarification; enforcement priority depends on the agreed purpose
- Dependencies: owner decision on suspension semantics; preserve inbound financial recovery.
- Status: Astra reviewed 2026-09-27. VERIFIED source behavior; QUESTION for intended access-control contract and resulting defect severity. Deployed admission outcomes NEEDS VERIFICATION. This is not accepted as an unconditional HIGH security defect.

## MBA-101 — Login and recovery endpoints have no application abuse limiter

- Category: Security
- Severity: HIGH
- Affected area: authentication, account recovery, transactional mail
- Evidence: `apps/api/src/auth/auth.controller.ts:28`, `:46`, `:71`; `apps/api/src/auth/signup-rate-limit.guard.ts:27`; `apps/api/src/app.module.ts:284`; `apps/api/src/auth/auth.service.ts:159`, `:247`. Challenge: [MBA-AUDIT-013](investigations/MBA-AUDIT-013.md).
- Current behavior: only signup has throttle metadata; the global signup guard passes the other handlers. Login, reset request/confirm and verification request/confirm have no limiter in the inspected controller/service/global-guard paths. Eligible requests can cause bcrypt work or fresh token/mail attempts.
- Problem: these sensitive routes have no checked-in application request budget. Current deployment edge controls are unknown; this finding does not establish their absence or a bypass.
- Impact: repeated authentication work and recovery/verification mail attempts are supported risks, including for platform-admin accounts. Actual credential compromise, delivered mail flooding or exhausted resources were not observed.
- Counterevidence: signup has Redis limits of 10/IP and 3/email per hour; reset/verification request responses are generic. Verification mail is limited to unverified users and request validation rejects some malformed inputs. Token entropy is separate from request-rate controls.
- Recommendation: add bounded per-account/trusted-client-IP limits to the affected handlers, retaining generic responses and useful failure auditing; verify edge behavior and proxy attribution separately. MFA/step-up policy is a separate design topic, not evidence for this throttle finding.
- Effort: M
- Timing: BEFORE PILOT
- Dependencies: trusted-proxy/IP model; account recovery UX.
- Status: VERIFIED FINDING for the bounded application paths, accepted by Astra 2026-09-27. Deployed edge behavior and actual abuse outcomes NEEDS VERIFICATION; no runtime attack or load probe ran.

## MBA-102 — Password reset leaves old sessions and other reset tokens valid

- Category: Security
- Severity: HIGH
- Affected area: account recovery and session lifecycle
- Evidence: `apps/api/src/auth/auth.service.ts:186`, `:199`, `:262`, `:324`, `:353`, `:423`; `apps/api/prisma/migrations/20260727190000_authentication_primitives/migration.sql:18`; `apps/api/src/tenancy/tenant-context.guard.ts:64`. Challenge: [MBA-AUDIT-013](investigations/MBA-AUDIT-013.md).
- Current behavior: reset GETDEL consumes one hashed Redis key, then updates the SQL password hash. Independent reset tokens remain eligible within their TTL; sessions store only userId and expire after 604800 seconds. Session lookup checks the current user but no password/auth generation; logout removes only the presented session.
- Problem: password reset alone does not revoke an already-held session or sibling reset link. Redis consumption before the password write also burns the submitted link if later hashing/SQL work fails; no cross-resource atomic reset/revocation is established.
- Impact: a party already holding a session or another unexpired reset token may retain access or change the password after recovery, subject to current user/role existence. Live Redis/SQL failures, race behavior and account compromise were not exercised.
- Counterevidence: reset tokens use 32 random bytes, hashed keys and a 3600-second TTL; GETDEL prevents replay of the consumed token. Token guessing or replay of that same successfully consumed token is not the finding.
- Recommendation: tie credentials and session/recovery validity to an authoritative per-user generation or equivalent revocation state, updated consistently with password reset. Define Redis/SQL failure and retry behavior explicitly instead of assuming a distributed atomic transaction, and provide explicit session termination.
- Effort: M
- Timing: BEFORE PILOT
- Dependencies: session/recovery contract; Redis-failure behavior.
- Status: VERIFIED FINDING for source lifecycle/revocation boundaries, accepted by Astra 2026-09-27. Runtime persistence, concurrency and compromise outcomes NEEDS VERIFICATION; targeted isolated regression remains required.

## MBA-103 — Property-scoped guest permissions authorize tenant-wide merge and dismissal

- Category: Security / Privacy
- Severity: HIGH provisional, pending the intended tenant-wide reviewer policy
- Affected area: guest duplicate review; multi-property staff isolation
- Evidence: `apps/api/src/tenancy/guests.controller.ts:9`; `apps/api/src/tenancy/guests.service.ts:89`, `:167`, `:196`, `:253`; `apps/api/prisma/migrations/20260730060000_guests/migration.sql:20`; `apps/api/prisma/migrations/20260730010000_bookings_state_machine/migration.sql:64`; ADR-0030 and data/access guest scope. Challenge: [MBA-AUDIT-014](investigations/MBA-AUDIT-014.md).
- Current behavior: the property route accepts OWNER/ADMIN or assigned PropertyStaff with guests.manage; writes require verified email. Duplicate listing reveals both profiles and tenant-wide booking counts when either profile has a local booking. Dismissal accepts any known flagged same-tenant guest ID without local-booking affiliation. Merge runs with tenant-only context and reassigns all tenant bookings for the losing profile.
- Problem: a property permission admits tenant-wide review and mutations, but the authority delegated to that reviewer is unspecified. The scope difference is verified; calling these actions unauthorized across properties is a LIKELY FINDING pending the reviewer policy.
- Impact: a delegated property reviewer can receive another property's candidate contact details and affect shared identity/history. A valid same-tenant flagged ID is needed for direct dismissal; the ordinary duplicate list exposes pairs only when either profile has a local booking. Actual SQL/RLS behavior was not exercised.
- Counterevidence: membership, assignment, capability, verified-email and same-tenant pair constraints apply. Guest is explicitly tenant-wide and ADR-0030 intentionally moves all losing-guest references. This is not a cross-tenant bypass, and tenant-wide movement alone is not a defect.
- Recommendation: define tenant-wide guest-management authority and permitted disclosure, then enforce an explicit permission or approved delegated-review rule. Test a property-A-only staff member against property-B-only and shared pairs. Preserve complete tenant-wide identity merges; filtering only the booking UPDATE by property would split the identity incorrectly. See [QUESTIONS](QUESTIONS.md).
- Effort: M
- Timing: BEFORE PILOT
- Dependencies: tenant-wide guest ownership policy; merge corrections MBA-104.
- Status: Astra reviewed 2026-09-27. VERIFIED source scope difference; LIKELY FINDING for excessive reviewer authority pending policy. Runtime RLS/SQL and real disclosure/mutation outcomes NEEDS VERIFICATION; no cross-tenant bypass established.

## MBA-104 — Guest merge rejects one canonical choice and leaves Clock identities behind

- Category: Backend / Integration / Data integrity
- Severity: HIGH
- Affected area: manual guest merge and returning-guest identity
- Evidence: `apps/api/src/tenancy/guests.service.ts:203`, `:233`, `:245`; `apps/api/src/integrations/clock/clock-booking.service.ts:292`, `:1570`, `:1585`; `apps/api/prisma/migrations/20260911100000_clock_guest_mappings/migration.sql:3`; ADR-0030 decision 4; data/access documentation's claim that merge moves Clock mappings. Challenge: [MBA-AUDIT-014](investigations/MBA-AUDIT-014.md).
- Current behavior: the method rejects `flaggedGuestId === canonicalGuestId`, although later logic and the accepted decision allow either candidate to be canonical. It moves booking links and backfills/tombstones guest profiles but never updates `clock_guest_mappings`.
- Problem: one offered canonical choice cannot work. A losing guest's external mapping stays attached to a hidden tombstone; canonical lookup no longer finds that mapping, while external identity uniqueness still reserves it.
- Impact: the flagged-as-canonical workflow fails. Canonical lookup misses a mapping held only by the tombstone; fallback email search can find the same external guest, but ON CONFLICT DO NOTHING cannot persist that mapping under the canonical ID while its external-ID uniqueness belongs to the tombstone. This supports repeated lookup/stale identity risk, not a demonstrated incorrect external booking or provider conflict. Documentation overstates mapping preservation.
- Counterevidence: the accepted pair must be active and same-tenant; arbitrary third-profile canonical IDs are rejected. The losing tombstone preserves FK validity. Existing fake-dependency tests pass for candidate-as-canonical and dismissal, but cover neither the rejected canonical choice nor mapping transfer/collision.
- Recommendation: permit either valid profile as canonical; reconcile all provider identity links in the locked merge transaction with explicit conflict handling when both profiles have mappings for the same property. Test both canonical choices, cross-property mappings, replay/concurrency and conflicting Clock identities.
- Effort: M
- Timing: BEFORE PILOT
- Dependencies: authorization decision MBA-103; preserve external identity provenance.
- Status: VERIFIED FINDING for canonical-choice rejection and omitted mapping preservation, accepted by Astra 2026-09-27. Two existing isolated unit tests passed; real SQL/RLS, collision handling, concurrency and Clock outcomes NEEDS VERIFICATION.

## MBA-105 — Tenant-supplied Clock host can direct server requests to arbitrary HTTPS targets

- Category: Security / Integration
- Severity: HIGH
- Affected area: Clock connection test and all Clock HTTP traffic
- Evidence: `apps/api/src/integrations/clock/clock-credentials.ts:14`; `apps/api/src/integrations/clock/clock-http-client.ts:171`; `apps/api/src/integrations/clock/clock-connection-ping.ts:53`; `apps/api/src/integrations/integration-connections.service.ts:119`.
- Current behavior: credential parsing checks only nonempty strings. `host`, account and subscription path parts are interpolated directly into a URL; the test endpoint makes a server-side request to it. TLS certificate verification is enabled but destination allowlisting, private-address rejection and path-component validation are absent.
- Problem: an authenticated tenant owner/admin with PMS access can supply a non-Clock host, port or URL delimiters and cause requests from the API's network. TLS validation is not a destination policy.
- Impact: SSRF into reachable HTTPS services and attacker-controlled destinations; upstream response information can be reflected in test results. Exploit reach depends on deployed DNS/network/TLS configuration, which was not probed.
- Recommendation: allow only approved Clock origins/regions, validate numeric/path identifiers, reject userinfo/path/query/fragment in hosts, and apply controlled DNS/egress rules. Keep test-only transports explicit. Add negative tests with malicious host shapes without contacting providers.
- Effort: M
- Timing: NOW
- Dependencies: official supported Clock host inventory; deployment egress policy.
- Status: VERIFIED_SOURCE; network exploitability deliberately not live-tested.

## MBA-106 — Schema repair leaves eleven foreign keys unrestored in the migration chain

- Category: Database / Security / Architecture
- Severity: MEDIUM — integrity and defense in depth; source confidence is high
- Affected area: booking/guest links, manual blocks, capability overrides, operations and audit-log parent/retention behavior
- Evidence: `apps/api/prisma/migrations/20260804114000_repair_schema_drift/migration.sql:13`, `:111`, `:180`; `apps/api/prisma/migrations/20260804115500_restore_room_type_images_fk/migration.sql:9`; complete checked-in migration inventory through `20260919130000`; corresponding Prisma scalar/relation fields. Per-family origins, replacements, RLS and source counterevidence: [MBA-AUDIT-016](investigations/MBA-AUDIT-016.md).
- Current behavior: the repair drops fourteen FKs. Two payment-session FKs return in the same migration and the room-image FK returns in the next. Eleven have no later replacement: booking–guest, guest–organization, operation–property, block–property, four block-target links, two override links and audit-log–organization. Existing booking property/catalog FKs are renamed, not removed. The repair's no-op description does not describe its DROP effect on a database where those constraints exist.
- Problem: the remaining RLS policies check row tenant/property fields, not whether referenced IDs belong to that scope or exist. Missing composite FKs remove that referential backstop. Scalar-only Prisma fields do not restore SQL-owned constraints; scalar-only modeling itself can be deliberate, as the restored room-image FK demonstrates.
- Impact: faulty or privileged writes can leave invalid/orphaned references. Scoped block deletion does not explicitly delete targets, so the lost block-target CASCADE can leave orphan targets if these migrations apply. Lost cascade cleanup applies only to links that originally cascaded; the override FKs were RESTRICT. Audit-log retention after organization deletion needs a policy decision. No invalid row, reachable cross-tenant exploit or deployed loss was demonstrated.
- Counterevidence: ENABLE/FORCE RLS declarations and scoped transaction context remain; the runtime-role migration declares NOSUPERUSER/NOBYPASSRLS. Block creation validates target scope, and capability evaluation joins through assignment/capability, so an orphan override alone does not grant a capability in that query. Deployed roles, policies and applied migrations remain unverified.
- Recommendation: verify the complete chain and constraints in a disposable migrated database under the intended roles; preflight invalid references, reconcile Prisma/SQL ownership and restore deliberate tenant-composite links with validation and rollback plans. Decide audit-log retention before reinstating its former CASCADE. Treat deployed inventory as a separately scoped action, not authorized by this source audit.
- Effort: L
- Timing: BEFORE PILOT
- Dependencies: disposable migrated PostgreSQL verification; retention ownership decisions.
- Status: VERIFIED FINDING for the checked-in migration-chain losses, accepted by Astra 2026-09-27. Severity narrowed from HIGH to MEDIUM because current evidence establishes weakened integrity, not an exposed tenant-isolation exploit. Effective schema, invalid-row outcomes and runtime cleanup NEEDS VERIFICATION; audit-log restoration semantics remain a QUESTION.

## MBA-107 — Invitation activation can create a verified user for an unrelated email

- Category: Security / Authentication
- Severity: HIGH
- Affected area: global account identity, staff invitations
- Evidence: `apps/api/src/tenancy/staff-invite.controller.ts:18`, `:35`, `:44`; `apps/api/src/tenancy/staff-invite.service.ts:66`, `:82`, `:215`, `:239`, `:253`, `:305`; `apps/api/prisma/schema.prisma:108`. Challenge: [MBA-AUDIT-013](investigations/MBA-AUDIT-013.md).
- Current behavior: a verified tenant OWNER/ADMIN with staff.invite can create an invitation and receive its token. Public activation accepts a separate email, does not compare it to the target, and inserts that email as verified. Existing-user redemption requires a session but checks neither its email nor verified state against the invite target.
- Problem: the creator-visible bearer token is treated as proof of mailbox control for a caller-supplied unused email. A forwarded/stolen token can also substitute a different signed-in recipient. Merely deriving activation email from the invite would still not prove mailbox control while its creator knows the token.
- Impact: false verification/account squatting for an unused third-party address, or unintended STAFF membership for a substituted existing recipient. This is not demonstrated takeover of an existing account, mailbox access, login bypass or cross-tenant access.
- Counterevidence: invitation creation has role, capability and verified-email guards; redemption enforces seat limits under an organization lock, assigns STAFF rather than OWNER/ADMIN and rejects platform-admin membership. Strong random tokens have hashed storage, expiry and GETDEL replay protection. Unique email prevents overwriting an existing exact-email account. SQL/assignment constraints still apply.
- Recommendation: bind both redemption paths to the normalized intended identity and define genuine mailbox proof independently of the creator-visible token. Define safe retry after validation, seat or SQL failure: consuming Redis before the transaction currently burns the link even if no account/access commits.
- Effort: M
- Timing: NOW
- Dependencies: invitation-token exposure/verification UX decision.
- Status: VERIFIED FINDING for the bounded identity/verification paths, accepted by Astra 2026-09-27. Deployed redemption, SQL/Redis outcomes and exploitation NEEDS VERIFICATION; no real account or mailbox was accessed.
