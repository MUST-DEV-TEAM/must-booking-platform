# Gaps found while executing the hardening queue

A running log. Each entry is something found **while building a slice** of [the hardening queue](../roadmap/hardening-queue.md) that was not part of that slice. It is written for the analysis by Fable: the entries are facts with how they were checked, plus the question that needs a decision. Nothing here is analysed or decided yet.

**Rules for this file**

- Add an entry the moment a gap is found; do not fix it silently inside another slice.
- Record only what was checked. Say how (code read at a file and line, a read-only query on a date, a CI log). Anything not checked is marked **Not verified**.
- No guest data and no secrets. Hotels by name are fine.
- Status values: **New** (not analysed), **Analysed** (Fable wrote a recommendation), **Sliced** (it became a queue slice), **Closed**.

Started 2026-11-16, covering the slices merged up to #510.

## Money, refunds and cancellations

| Id | Gap | Where and how it was checked | Question for Fable | Status |
| --- | --- | --- | --- | --- |
| G-01 | The refund outcome of a staff cancellation lives only in the answer, one review item and the audit trail. The booking row has no field for it, although Milestone 40 task 2 says "on the booking". | Read `booking-requests.service.ts` (`execute`) and the booking table in `schema.prisma` while building 40-2a, 2026-11-16. | Is a booking-level field (refund state, amount, cash to return) needed for reception and reports, or is the review item enough? | New |
| G-02 | The guest is never told about a refund that was not made, is pending, or has a cash part to collect. The cancellation email carries no refund details; the guest only receives a refund email once a refund is confirmed. | Read `booking-cancellation-notification.service.ts` (guest email is built without refund details) and `payment-refund.service.ts` (refund email only on `REFUNDED`). | What should the guest be told in each case, and by whom (system email or staff call)? | New |
| G-03 | Cash plus card works only for exactly one online charge plus in-person charges in one currency. Two online charges, or mixed currencies, still end as `REFUND_ALLOCATION_REVIEW_REQUIRED`. | Read `cancellationRefund` and `refundCharge` (40-2b, #506). | Do real bookings ever have two online charges (a second payment link, a top-up)? Needs a read-only count at Empire and Luxury. | New |
| G-04 | The path for a hotel that cancels inside Clock (`hotel-cancellation-refund.service.ts`, `refundRemainingChargeForBooking`) does not use the cash plus card split. A mixed booking there still ends as a review item. Its "already refunded" figure counts all refunds, not only online ones. | Read both services after 40-2b. | Should the Clock-cancel path use the same split? | New |
| G-05 | Not verified: whether `execute()` in `booking-requests.service.ts` can throw (not return a failure) after the cancellation has committed, which would answer an error for a booking that is already cancelled. | Noticed while reading; not tested. | Is the existing "decision-commit failure" recovery enough, or does the refund step need its own guard? | New |
| G-22 | The guest gets no email saying a cancellation request was received (audit L15). It needs a new guest template: an email template key and default text, a guest notification topic with its on/off setting, a catalog entry, and the tests that list them. Split from 40-5b as slice 40-5c. | Read `booking-update-notification.service.ts`, `email-templates.ts`, the template catalog and `notification-recipients.ts` while building 40-5b, 2026-11-16. | Confirm the wording and whether the property can switch it off. | Closed (built as 40-5c) |
| G-23 | A cancellation request saved before 2026-11-16 has no saved dates or total, so approval can compare its payments and its status, and the cutoff (which follows the arrival date), but not the total. The refund the reviewer approved is the saved amount, validated against the current payments when it is issued. | `bookingChangedSinceRequest` in `booking-requests.service.ts`. Two such requests are open on Must Hotel (audit tests 1 and 9). | Accept, or expire and re-create old requests? | New |
| G-24 | A cancellation preview loaded in a browser before the 40-5b deploy has a different hash (the evidence gained dates and the total), so submitting it answers "reload the preview" once. | Reasoned from `evidence()`; not observed. | None needed; listed so a one-off "reload" report is understood. | New |
| G-25 | The "cancellation request received" guest email starts switched OFF for every hotel that already exists (the convention for new guest emails), so Empire's and Luxury's guests still get no acknowledgement until each hotel turns it on in its notification settings. New hotels get it on. | Migration `20261116150000_cancellation_request_received_email`; read how `guestNotificationEnabled` treats a missing row. | Luxury is still off (owner's call). Should future guest emails default to on? | Partly done: switched ON for Empire Beach Resort on 2026-11-17 on the owner's yes (one row in `notification_topic_settings`, set back with `UPDATE ... SET guest_enabled = FALSE`); Luxury and Must Hotel still off |

## Review queue and keys

| Id | Gap | Where and how it was checked | Question for Fable | Status |
| --- | --- | --- | --- | --- |
| G-06 | The dedupe key is category, kind, reference type and id. Raisers that set no `kind` (most payment-mismatch items) put different problems under one key. After the clean-up only the oldest item per key has a key; the others stay unkeyed and open. | Read-only query 2026-11-16: Empire 3 groups of payment-mismatch items on one booking with up to 5 different messages; Must Hotel 2 groups with up to 3. | Give every raiser an explicit `kind`, then back-fill, so the unique index covers every open item? | New |
| G-07 | 456 of Must Hotel's 932 open review items have no reference id and cannot be keyed or deduplicated. | Read-only query 2026-11-16. They are test-hotel items; Empire and Luxury have none of this kind. | Leave as is (test hotel) or require a reference id from every raiser? | New |
| G-08 | Luxury has 32 open items (11 missing mappings, 18 currency or result notes, 3 payment notes). One month of availability (April 2027) fails with "needs connection or room-mapping review". | Read-only queries 2026-11-16 (review items, `clock_sync_jobs`). Known as Milestone 39 task 12; waits on hotel staff. | Nothing new; listed so the analysis has the current numbers. | New |

## Clock connection and webhooks

| Id | Gap | Where and how it was checked | Question for Fable | Status |
| --- | --- | --- | --- | --- |
| G-09 | Connections that already existed before #509 (for example the old demo connection) do not get live updates automatically. Only a connection linked to a hotel after 2026-11-16, or the "Turn on live updates" button, runs the setup. | Read `setPropertyConnection` and `ClockLiveUpdatesService`. | One-off catch-up for every Clock connection that has no pinned topic? Needs a read-only count first. | New |
| G-10 | When a Clock account already has a subscription pointing at another address (for example an old, deleted connection's webhook id), the setup reports `endpoint_differs` and changes nothing. No tool re-points or removes a subscription. | By design in `ClockLiveUpdatesService`; the Clock API has GET, POST and DELETE on the subscription. | When may a subscription be re-pointed or deleted, and who approves it? | New |
| G-11 | The live-updates setup has unit tests only. It has not been run against a real, new Clock connection. | Test list for #509. The Must Hotel demo account could be used. | Run it once on the Must Hotel demo account and record the result? | New |
| G-12 | The webhook health check (`ClockWebhookHealthService`) was noted on 2026-09-30 as counting 0 connections for a connected hotel. | Open question in `docs/integrations/clock/runbook.md`. **Not re-checked.** | Still true? If so, nothing alerts when a hotel's webhook is silent. | New |
| G-13 | 928 jobs sit on the Clock dead-letter queue. The first alert email (from #507) will report that number. They are old; counting and clearing them is 39-8b and 39-8c. | Read-only `LLEN` on the queue 2026-11-16. | Nothing new; owner review of 39-8b numbers is the gate. | New |

## Notices and attention

| Id | Gap | Where and how it was checked | Question for Fable | Status |
| --- | --- | --- | --- | --- |
| G-14 | Multi-room orders confirmed at the hotel never produced a "Booking created" notice and still do not. That path also sets the status with a direct SQL update (`multi-room-booking.service.ts`, the Clock-free branch), bypassing the state machine. | Read the code while building 40-7a; the e2e for multi-room passes unchanged. | Route it through the state machine, and add the notice? | New |

## Build, tests and tooling

| Id | Gap | Where and how it was checked | Question for Fable | Status |
| --- | --- | --- | --- | --- |
| G-15 | The required "Clock staging tests" check failed on every PR from 2026-11-16 early (expired demo trial). It blocks merging and, because the deploy needs a green CI on `main`, it skipped deploys. The owner approved admin merges and manual deploys for #498, #499, #501; it turned green again later that day. | CI logs, `gh` output. | Should an external service's outage block merging and deploying, or should that check report but not gate? | New |
| G-16 | A manually started deploy stayed "queued" with no jobs for 12 minutes and could not be cancelled (409). Starting another deploy replaced it. | `gh api` on the run, 2026-11-16. | A note in the deploy runbook. | New |
| G-17 | Tests that failed once and passed on re-run: `payments.test.tsx` (fixed in #504), the Clock webhook recovery e2e "missing-job recreation via the real sweep path" (30 s timeout on #509 and again on #511, a docs-only change, both passed on re-run), `reports.test.tsx` (earlier, from the queue file). | CI logs. | Fix the recovery test's timing; keep a list of known flakes? | New |
| G-18 | Local runs differ from CI: `npx vitest` failed all web tests with "Cannot read properties of null (reading 'useState')" while `pnpm exec vitest` passed; `-t` filtering fails `payments.test.tsx` in isolation (also on `main`); two `local-pms-clock-availability` specs fail without `WEB_APP_URL`; `tsc` ran out of memory while the Docker box was busy; Prettier run from `apps/api` accepted a file the root check (CI) rejected. | Hit each of these on 2026-11-16. | Put a short "how to run checks locally" in AGENTS.md. | New |
| G-19 | The isolated Docker test box script (`mbci.sh`) only works with a Windows-style repo path (`MBCI_REPO=C:/Users/...`). | First end-to-end use, 2026-11-16. | Fix the script default. | New |
| G-20 | A one-off script printed its result on stdout, but the application's logger also writes to stdout, so log lines ended up inside a saved encrypted credential for Luxury (unreadable for a few minutes, restored from backup, no sync ran). Also, Python on Windows reads files as cp1252 unless told otherwise. | Luxury webhook work, 2026-11-16; runbook section "Luxury production". | A standing rule for one-off scripts (write results to a file, verify before saving). | New |
| G-21 | Garbled characters ("â€…") sit in older files: `schema.prisma` comments, `pokpay-payment.provider.ts`, `pokpay-payment.service.ts`, two dashboard venue files, three docs. | `git grep` on 2026-11-16. | Repair in one formatting-only change. | New |
| G-26 | 40-7b treats a closed deposit folio as also covering a deposit converted to an invoice. The folio data the code reads has no "converted" field, and it is not confirmed that Clock closes every converted deposit. A converted folio that stayed open would get no Deposit Adjustment item. | `postRefund` in `clock-booking.service.ts` and the `ClockFolioResource` fields (`closed_at`, `voided_at`), 2026-11-17. | Check one real converted deposit folio in Clock (read-only) to see whether it has `closed_at`. | New |
