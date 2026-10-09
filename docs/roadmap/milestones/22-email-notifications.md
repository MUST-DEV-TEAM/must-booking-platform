# Milestone 22: Email Notifications (delivery, recipients, templates)

Status: **Phase A and Phase B (Tasks 1-6) implemented and running in production since 2026-10-01 (verified below); Phases C-G (recipient rules, templates, Email tab, pluggable transport) not started.** One open correctness gap: guest pay-at-hotel bookings produced no email in the 2026-09-30 evidence (see "Verified in production 2026-10-01").
Runs as an authorized ad hoc track, parallel to the main 13 - 14 - 15 sequence (same pattern as Milestone 21). It does not renumber the main sequence.

## Goal

Make transactional email reliable, observable and configurable per property:

1. When a booking is made, the guest and the right hotel people get an email — and if a send fails, someone can see it and retry it.
2. Hotels choose who receives each notification (To / CC / BCC) instead of it depending on who happened to be invited as staff.
3. Hotels can edit the wording of each email safely, from an **Email** tab in settings.

## Trigger

On 2026-09-30 a real booking on the live system produced **no email to the guest and no email to any staff member**. Nothing was visible to the owner because sends are fire-and-forget (see below).

## Current state (verified in code 2026-09-30)

- **Provider:** Resend, called directly over HTTPS from `apps/api/src/mail/resend-mail.provider.ts`. Needs `RESEND_API_KEY` and `MAIL_FROM_EMAIL`; both are optional in `config/environment.ts`, so a host missing them boots normally and only fails at send time.
- **Rendering:** one branded layout (`email-layout.ts`) with subject/body text hard-coded per email type in the provider. Not editable by hotels.
- **Events implemented:** email verification, welcome, password reset, staff invitation, booking confirmed (paid / pay-at-hotel), new-booking staff notification, booking cancelled (guest + staff), refund processed.
- **Failure handling:** `PaymentNotificationService.*Safely()` catches every error and only writes a log line ("continuing core action"). There is no record of what was sent, no retry, no status, no UI. The Resend call has no timeout.
- **Recipients:** guest = the booking's guest email. Staff = every row in `property_staff_assignments` for the property, regardless of role. Those rows are only created through the staff invite/assignment flow, so an owner who was never assigned, or a property with no assigned staff, receives nothing. No CC/BCC, no per-property configuration.
- **Trigger points:** `sendAfterConfirmation` is called from the PokPay confirmation, the Stripe webhook, and the pay-at-hotel branch of `LocalPmsProvider.createBooking`. **Suspected gap (unverified):** no call exists on the Clock-adapter booking path, so a Clock-connected property may never send booking emails on some payment methods. Task 1 must confirm or refute this.
- Existing static design references live in `apps/api/src/mail/design-reference/emails/` (10 HTML mock-ups). `docs/design` and `docs/product-overview.md` mention "full operational email tooling" as unimplemented Figma scope.

## Decisions (owner answers 2026-09-30)

| # | Decision | Outcome |
| --- | --- | --- |
| A | Platform mail transport | **Pluggable.** Resend stays the default; the platform admin (system owner) can configure an alternative **SMTP** transport in the platform admin area (credentials encrypted like integration credentials). Requested by the owner's boss. Amazon SES/Postmark can plug in later behind the same interface. |
| B | Hotel sending identity | **Three levels, per property:** (1) platform sender with hotel name as display name and hotel email as Reply-To (default); (2) hotel's own domain verified through DNS (SPF/DKIM) so mail is sent as `bookings@hotel-domain`; (3) hotel's own SMTP server, with "Connect Google/Microsoft" (OAuth) as a later sub-task because plain-password SMTP is increasingly blocked by those providers. On failure of the hotel's own transport the email is marked **failed and alerted**, not silently re-sent from a different address. |
| C | "Receive email where they want" | Interpreted as: booking alerts and guest replies land in the hotel's own mailbox (recipient rules + Reply-To). An **in-app inbox / inbound mail parsing is out of scope** — **Confirmed by the owner 2026-09-30: this reading is correct.** |
| D | Template format | Two authoring modes per template: **visual editor** (default; bold/links/lists/placeholders) and **advanced HTML**. One is the source of truth; the other is derived (text -> HTML is safe; HTML -> text is lossy and warns). Every email is sent multipart (HTML + plain text). Hotel-authored HTML is **sanitized** (tag/attribute allow-list, no scripts/forms/remote tracking) and rendered inside the locked platform header/footer. |
| E | Languages | **English only for v1.** Data model keeps a language column so more can be added without rework. |
| F | Owner/manager as recipients | Recipient rules reference roles (owner, manager, any role template) and/or explicit addresses, in addition to individual staff. |
| G | Queue | Reuse BullMQ/Redis (ADR-0031) for send + retry. |

**Known limits of SMTP transports:** SMTP has no idempotency key (duplicate prevention must come from `email_messages`) and gives no delivery/bounce webhooks (log shows "accepted by server" at best).

## Phases

### Phase A — Stop the bleeding (small, do first)

| # | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 1 | Diagnose why the 2026-09-30 live booking sent nothing | Determine from live evidence (API container logs, host `.env` for `RESEND_API_KEY`/`MAIL_FROM_EMAIL`, Resend dashboard for the sending domain and any API activity) which cause applies: missing env, unverified domain / rejected sender, Resend error, or send path never invoked (e.g. Clock adapter path, payment method). Report the finding with the evidence; fix the configuration or missing call. Confirm with one real end-to-end booking on each payment method that is used in production. Destructive/host operations follow the SSH rules in AGENTS.md. | **Done 2026-09-30 — no fault found; see findings below.** Owner confirmed the 09-28 emails arrived (a personal mailbox rule had hidden them). Still unverified: Clock-adapter pay-at-hotel path (owner deferred). |
| 2 | Fail loudly at boot and add a request timeout | Missing `RESEND_API_KEY`/`MAIL_FROM_EMAIL` logs an explicit error at startup in production (warning elsewhere, silent under test) instead of only failing at send time; it deliberately does **not** refuse to boot, so a host without mail still runs. A malformed `MAIL_FROM_EMAIL` or `RESEND_API_BASE_URL` fails validation. The Resend `fetch` has a 10 s abort timeout. Unit tests: `test/environment.spec.ts`, `test/resend-mail.provider.spec.ts` (14 passing). | **In review 2026-09-30** — implemented, not deployed. Refusing to boot is a one-line change if the owner prefers it. |

**Task 1 findings (2026-09-30, read-only checks on `booking.must.al`):**
- `RESEND_API_KEY` and `MAIL_FROM_EMAIL` are set on the host and inside the API container. There is no `MAIL_PROVIDER` env; the provider is hard-wired to Resend, so that is not an issue.
- Resend's own records show the sender domain `mail.dejvis.dev` is **verified** and that the system **did send** booking emails for the last real booking, `EBR-260928-2304-A7YS` (2026-09-28 23:04 UTC, PokPay): guest confirmation delivered, staff "new booking" delivered to the one real assigned staff address, later refund and cancellation emails delivered. So the mail pipeline works end to end for PokPay.
- Earlier bookings (e.g. `MH-260918-*`) show staff emails **bounced** to auto-provisioned `front-desk+<uuid>@...`, `finance+...`, `property-manager+...` addresses — these were the auto-created staff accounts removed by commit 55e15e7; Empire Beach Resort now has a single real assignment, and Must Hotel has 5 (not inspected).
- **No booking exists in the database after 2026-09-28 23:04 UTC, no Resend email after 2026-09-29 00:17 UTC, and no booking-related request appears in the API log since the container restarted 2026-09-29 00:14 UTC.** The "live booking with no email" is therefore not visible on this host; it needs the exact booking (time, reference, payment method, guest email) to trace. Possible explanations still open: booking made against a different environment/host, booking abandoned before payment/confirmation, or a Clock-side or import path that never invokes the confirmation code (suspected gap above, still unverified).
- Observation for Task 2/18: guests currently receive mail from `mail.dejvis.dev`, a personal domain of the owner, not a platform/hotel domain.

**Verified in production 2026-10-01 (read-only checks on `booking.must.al`):**
- Migrations `20260930100000_email_messages`, `20260930110000_email_messages_delivery_webhook` and `20260930120000_email_messages_platform_mail` are applied. `RESEND_API_KEY`, `MAIL_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` and `REDIS_URL` are set in the API container, and `POST /webhooks/resend` is mapped.
- `email_messages` holds 9 rows from 2026-09-30/10-01. Every row stores a provider message id. 6 are `DELIVERED` (so the Resend webhook is configured and verified end to end); the 3 `SENT` rows are staff notifications to `@must.test` addresses of the demo "Must Hotel" account, which never confirm delivery.
- Empire Beach Resort has exactly 1 assigned staff recipient, so only one person receives "new booking" mail. Owner/manager are not resolvable until Phase C (Task 7).
- **Gap still open (evidence, not proof):** every PokPay booking has email rows (3 and 6), but the PAY_AT_HOTEL bookings on 2026-09-30/10-01 (Empire at 21:15 and 22:11 UTC, and three on Must Hotel) have **0** email rows. All were later cancelled test bookings, and it is not recorded whether they came from the guest flow or staff tooling, so the Clock-property pay-at-hotel guest flow still needs one real end-to-end booking to confirm or clear it.
- `test/mail-delivery.e2e.spec.ts` has 2 failing tests in a local full run (`provider_message_id` is null where the test expects the mock id) although production rows do carry the id; treat as a test/mock mismatch to resolve before Phase C.

### Phase B — Email log and durable sending

| # | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 3 | `email_messages` table (tenant/property scoped, RLS) | One row per intended email: tenant, property, booking (nullable), event type, recipient address + kind (to/cc/bcc), rendered subject, template version, status (`queued`/`sent`/`failed`/`delivered`/`bounced`/`complained`), provider message id, attempt count, last error, timestamps. Additive migration only. Tenant and property isolation proven by a real-database test, consistent with existing RLS conventions. | **In review 2026-09-30** — migration `20260930100000_email_messages` (additive; enums `EmailMessageStatus`/`EmailRecipientKind`; tenant FK to `organizations`, composite property FK, `UNIQUE(tenant_id, idempotency_key)`; tenant+property isolation policy plus platform-admin read-only policy) and Prisma `EmailMessage` model. `property_id` is nullable for tenant-level mail; `booking_id` is a plain UUID (no FK) so the log outlives a booking. `test/email-messages-rls.e2e.spec.ts`: 7 real-Postgres tests pass (no-context sees nothing, tenant isolation, property narrowing, cross-tenant/property writes rejected, composite FK, idempotency uniqueness per tenant, platform admin read-only). **Not deployed.** (Task 6 later made `tenant_id` nullable for account-level mail.) |
| 4 | Send through a queue with retry and idempotency | Confirmation flows enqueue instead of sending inline; a worker sends via Resend, retries transient failures (network, 429, 5xx) with backoff, and marks permanent failures (4xx) `failed` with the provider error. The existing Resend `Idempotency-Key` behavior is preserved so a retry never double-sends. A core action (payment confirmation, cancellation) still never fails because of email. **Verification:** behavioral tests with a failing then recovering provider prove retry-then-success, permanent failure recording, and no duplicate send. | **In review 2026-09-30** — `MailDeliveryService` (`apps/api/src/mail/mail-delivery.service.ts`): every booking/staff/refund/cancellation email is first written to `email_messages` (QUEUED) and sent by a BullMQ worker on queue `mail.transactional` (5 attempts, exponential backoff from 5 s; completed jobs kept 24 h, failed 7 d). Transient errors (network/timeout/408/409/425/429/5xx) retry; other 4xx and exhausted retries set FAILED with the error; success records SENT + Resend message id. Dedupe via `UNIQUE(tenant_id, idempotency_key)` (a replay never re-sends; a row left QUEUED by a crash is re-enqueued) plus the Resend `Idempotency-Key` reused on every retry. If Redis is unavailable the email is sent inline once. `dispatch` never throws, so payments/bookings/cancellations cannot fail on email. Subjects/keys now come from one place (`mail-descriptors.ts`) shared by the provider and the log. `PaymentNotificationService.*Safely` now take a `{tenantId, propertyId}` second argument (all 8 call sites updated). `test/mail-delivery.e2e.spec.ts`: 7 real Postgres + Redis/BullMQ tests (success, retry-then-success with exactly 3 sends, permanent failure = 1 send, exhausted retries, concurrent + replayed duplicate = 1 row/1 send, never throws, no-queue inline fallback). Job payloads (guest name/email/phone) sit in Redis for the retention windows above. **Not deployed.** Known limits: a crash after the provider accepts but before the `SENT` write leaves the row QUEUED (the email went out; provider idempotency prevents a duplicate on retry) — a sweep for stale QUEUED rows is not built; auth/invite emails are not routed through the queue yet (Task 6). |
| 5 | Resend delivery webhooks | Verified-signature endpoint updates `email_messages` to delivered / bounced / complained. Replayed events are idempotent. | **In review 2026-09-30** — `POST /webhooks/resend` (`resend-webhook.controller.ts`): Svix-style signature check (HMAC-SHA256 over id.timestamp.body, constant-time compare, supports rotated multiple signatures, rejects timestamps older than 5 min) using new env `RESEND_WEBHOOK_SECRET`; refuses with 503 while the secret is unset rather than accepting unsigned events. `ResendWebhookService` moves `email_messages` forward only: delivered (from QUEUED/SENT), bounced (with Resend's bounce type/message, from QUEUED/SENT/DELIVERED/FAILED), complained (from any), failed/suppressed (from QUEUED/SENT); opened/clicked/delayed ignored; a late `delivered` never overwrites `bounced`; replays are no-ops. Rows are matched by provider message id under a new narrow `email_webhook` RLS role (migration `20260930110000_email_messages_delivery_webhook`: select+update on this table only). An unknown fresh (<2 min) email returns 503 so Resend retries (it can report delivery before our `SENT` write lands); an old unknown one is acknowledged. `RESEND_WEBHOOK_SECRET` added to `compose.homelab.yaml`, `homelab.env.example`, `.env.example`. Tests: `resend-webhook-signature.spec.ts` (5) and `resend-webhook.e2e.spec.ts` (9, real Postgres). **Not deployed. Owner action needed at deploy:** create a webhook in the Resend dashboard for `https://booking.must.al/webhooks/resend` with events email.delivered, email.bounced, email.complained, email.failed, email.suppressed, put its signing secret into the host `.env` as `RESEND_WEBHOOK_SECRET`, and recreate the API container. |
| 6 | Route every existing email through the log | Verification, welcome, reset, invitation, confirmation, staff notification, cancellation and refund emails all produce log rows. Any newly found path missing a send (see Task 1) is closed. | **In review 2026-09-30** — the four remaining kinds (verification, welcome, password reset, staff invitation) now go through `MailDeliveryService` and the log; every existing email type is covered (booking/staff/refund/cancellation from Task 4). **Decision taken (owner's open point from Task 3):** account-level mail has no hotel account, so `email_messages.tenant_id` is now nullable (migration `20260930120000_email_messages_platform_mail`): those rows are invisible to every tenant, readable by the platform admin, written only under a new narrow `platform_mail` role, with a partial unique index for duplicate protection. Staff invitations are logged under the hotel account with no property. **Account mail is sent inline first** (`dispatch(..., { inlineFirst: true })`): the first attempt happens before the request returns, exactly as direct sending did, and the queue only retries a transient failure (total attempts unchanged). This keeps signup/invite behaviour and the ~45 e2e suites that read the mock mail provider synchronously intact. **Secret links:** idempotency keys no longer contain the raw verify/reset/invite token (a 24-hex SHA-256 fingerprint is used), and jobs for those three kinds are removed from Redis immediately on completion and after 1 h on failure (other mail: 24 h / 7 d). Key format changed, so a replay across this deploy is treated as a new email (acceptable: tokens are single-use and short-lived). `AuthService` and `StaffInviteService` now inject `MailDeliveryService` instead of the raw provider. Tests: `mail-delivery.e2e.spec.ts` (+4: inline-first, retry budget, permanent failure/replay, invitation scope, no secret in key), `email-messages-rls.e2e.spec.ts` (+1 platform_mail isolation), provider spec updated for hashed keys; auth/onboarding/staff-invite/admin-staff/platform-admin/tenant-dashboard e2e still pass. **Not deployed.** |

### Phase C — Recipient rules

| # | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 7 | `notification_recipient_rules` model + resolver | Per property and per event type: guest on/off; To/CC/BCC entries each one of {specific staff user, role/role template, explicit email address, property notification address}. Resolver returns a de-duplicated recipient list. Migrating properties get defaults that reproduce today's behavior plus the property notification address, so nothing changes silently. Owner is resolvable as a role. | **Done 2026-10-09** (email plan Step 1). Tables `notification_topic_settings` (guest on/off, custom-or-default staff) and `notification_recipient_rules` (account role OWNER/ADMIN, property role, specific staff, extra address), RLS per tenant/property. Topics: `new_booking`, `booking_cancelled`, `refund_processed` (`src/mail/notification-topics.ts`). No saved row = the old default (assigned staff, else owners/admins), so nothing changed on deploy. Each recipient gets their own email (no CC/BCC); duplicates across rules are removed. |
| 8 | Send layer uses the resolver | Staff/guest notification code calls the resolver instead of querying `property_staff_assignments` directly. Empty staff resolution is logged and surfaced (not silent). Provider `send` supports cc/bcc/reply-to. | **Done 2026-10-09.** Confirmation and cancellation use `staffRecipients(tx, context, topic)`; guest emails are skipped when the property switched them off (`PaymentNotificationService`). An empty staff list logs a warning. CC/BCC dropped: separate emails per recipient keep addresses private and give per-recipient delivery status. |
| 9 | Recipient rules API | Capability-guarded read/update endpoints scoped to tenant/property with validation (address format, ownership of referenced staff/roles, size limits). Contract types added to `packages/domain-contracts`. | **Done 2026-10-09.** `GET /tenants/:t/properties/:p/notification-settings` (topics, rules, resolved recipients, role and staff options) and `PUT .../notification-settings/:topic`; `settings.manage` capability, verified email for writes, audited. Contracts in `packages/domain-contracts`. Test: `test/notification-settings.e2e.spec.ts`. |

### Phase D — Templates

| # | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 10 | Template storage and safe rendering | Per property, event, and language: subject + body stored with a version and a source format (visual or HTML); the other format (HTML/plain text) is derived, and switching HTML -> text warns about lost formatting. HTML is sanitized with an allow-list. Fixed layout (header, logo, footer, summary table, CTA) stays in code. Placeholders come from a whitelist per event; unknown placeholders are rejected on save; all values are HTML-escaped at render; a missing template falls back to the shipped default. No arbitrary HTML/script injection — proven by tests including hostile placeholder values. | Not started |
| 11 | Default templates (English) | Every event ships with reviewed default text; language column present for later additions. | Not started |
| 12 | Template API | Read/update/reset-to-default, plus **preview** (render with sample data) and **send test to me**. Capability-guarded, tenant/property scoped. | Not started |

### Phase E — Email tab (dashboard)

| # | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 13 | Recipients screen | One row per event with guest toggle and To/CC/BCC pickers. Uses the design system and Figma/Claude design references; verified visually, not only by tokens. | Not started |
| 14 | Templates screen | Visual editor and advanced-HTML mode with placeholder picker, live preview, send-test, reset-to-default. | Not started |
| 15 | Sender and activity screens | Sender name / reply-to; activity list from `email_messages` filterable by booking/status, with **Resend** for failed rows (idempotent, audited). | Not started |

### Phase G — Pluggable transport and hotel-owned sending

Depends on Phase B (queue/log). Numbering continues to avoid renumbering earlier tasks.

| # | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 16 | Transport abstraction | Split "what to send" (templates/recipients) from "how to send" behind a `MailTransport` interface (send, optional cc/bcc/reply-to, capability flags: idempotency, delivery webhooks). Resend implements it with no behavior change. | Not started |
| 17 | Platform SMTP transport + admin setting | SMTP transport (host, port, TLS mode, user, password, from address) selectable by the platform admin; secrets encrypted at rest and never returned by the API; "send test email" and connection check; active-transport change is audited. Only platform-admin capability may change it. | Not started |
| 18 | Per-property sender settings (levels 1-2) | Sender name, reply-to, and optional custom domain with DNS-record display and verification status (via the transport's domain API where available). Unverified domain never used for sending. | Not started |
| 19 | Per-property own SMTP (level 3) | Property-scoped SMTP credentials, encrypted, tenant-isolated, with test-send. Failed sends recorded as `failed` and surfaced in activity; no cross-sender fallback. Google/Microsoft OAuth connect is a separate follow-up once needed. | Not started |
| 20 | Admin/Email-tab UI for transports | Platform admin transport screen; property Sender screen with the three levels and verification/test states. | Not started |

### Email plan Step 2a — scheduled emails (done 2026-10-09)

- Guest **pre-arrival reminder** (`pre_arrival`, default 3 days before check-in, 1-30 settable) and **owner daily summary** (`owner_daily_summary`: today's arrivals/departures, in-house tonight, yesterday's new bookings with revenue and cancellations; default recipients = account owners).
- `ScheduledEmailService` (BullMQ queue `mail.scheduled`, sweep every 15 min, not started under `NODE_ENV=test`) visits every property in its own time zone via the definer function `scheduled_email_properties()`; summary from 07:00, reminders from 09:00 local. Fixed idempotency keys mean one email per booking/order or per owner per day.
- Reminders go only to direct bookings: Clock-imported reservations (`CLOCK-…`) may come from other channels whose guests we may not email; bookings made the same day are skipped. Multi-room orders get one reminder.
- Both start **off for every property that existed before** migration `20261009140000_scheduled_emails`; new properties get them on. Settings gained `staffEnabled` and `daysOffset`.
- New generic mail kind `rendered` (`MailProvider.sendRenderedEmail`, supports reply-to) for emails rendered by the caller.

### Email plan Step 2b — instant alerts (done 2026-10-09)

- `AlertEmailService` (BullMQ queue `mail.alerts`, every 5 min, not started under `NODE_ENV=test`) reads the definer function `notification_alert_events(from, to)` for the last three closed 5-minute windows and sends at most one email per window and recipient (the key names the window), so bursts become one email and re-checks never resend.
- Property owners (topic `owner_alerts`, "Problem alerts"): bookings entering an attention status (manual review, payment/availability failed, Clock rejected / unknown result), new Clock manual-review items and failed Clock webhook events. Topic `refund_processed` gained a staff email ("refund made"). Both default to the account owners and start **off for properties that existed before** migration `20261009160000_alert_emails`.
- System owner: the same problems for every hotel plus failed/bounced/complained emails (not its own alert emails) and new hotel signups, sent to `PLATFORM_ALERT_EMAIL`; a daily platform summary (definer function `platform_daily_stats(day, tz)`) from 07:00 in `PLATFORM_TIMEZONE` (default Europe/Tirane). Unset `PLATFORM_ALERT_EMAIL` = none of these.

### Email plan Step 2c — booking changed and payment not completed (done 2026-10-09)

- Guest **booking changed** (`booking_changed`): when Clock hydration moves a confirmed booking's dates or room type (room-number assignment alone is not a change), the guest gets the new details and what they were before. Sent from `ClockBookingHydrationService` after the transaction; key names the new stay, so repeated syncs send once.
- Guest **payment not completed** (`payment_not_completed`): when `PaymentExpiryService` expires an unpaid booking, the guest is told the booking was not made, that nothing was charged (a late payment is refunded automatically) and gets a "Book again" link to the hotel website. One email per booking or multi-room order.
- Both are guest-only, direct bookings only (not `CLOCK-…`), and start **off for properties that existed before** migration `20261009180000_booking_update_emails`. Our own platform cannot change a confirmed booking's stay yet, so Clock is the only source of changes today.

### Email plan Step 1 follow-up — staff mute (done 2026-10-09)

- Each member can mute the non-urgent staff emails for themselves: `GET/PUT /tenants/:tenantId/my-email-preferences` (`muteOptionalEmails`), stored on `tenant_memberships.mute_optional_emails`. Optional topics are marked `optional` (today: daily summary, refund made); new booking, cancellation and problem alerts can't be muted. Extra addresses have no account and are never muted.

### Phase F — Out of scope / later (recorded, not scheduled)

- In-app mailbox / inbound email parsing and threading.
- Google/Microsoft OAuth mailbox connection (follow-up to Task 19).
- Marketing/bulk email, unsubscribe management for non-transactional mail.
- Pre-arrival reminder and post-stay emails (can reuse Phases B–D once they exist).
- Raw-HTML template editing.
- SMS/WhatsApp notifications.

## Suggested order and notes

Ship Phase A immediately (it is a live bug). Phases B and C fix reliability and the owner/manager gap and are useful without any UI. Phase G (pluggable transport, hotel-owned sending) needs Phase B first. Phases D and E are the configurable-templates product feature and can be dispatched task by task afterward.

## Documentation to update when work lands

`docs/architecture/frontends-and-api.md` (endpoints), `docs/architecture/data-and-access.md` (new tables/RLS), a new ADR for the email log/queue/template model, `docs/operations/` (required mail env vars and Resend domain/webhook setup), and the roadmap index.
