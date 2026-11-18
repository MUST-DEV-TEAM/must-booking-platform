# Failed Clock events and the dead-letter queue: counts (2026-11-18)

Slices 39-7b and 39-8b of [the hardening queue](../roadmap/hardening-queue.md): counts only. Everything here was read on live without changing anything (database selects, Redis reads, and read-only GETs of the Clock sandbox for Must Hotel). No guest data is listed. Steps 3 of both tasks (39-7c, 39-8c) change live rows or Redis and wait for the owner's go.

## 1. Failed webhook events (`provider_events`, status FAILED)

| Hotel | Event type | Age | Events | With a saved reason |
| --- | --- | --- | --- | --- |
| Empire | folio_update | 14 to 60 days | 837 | 0 |
| Empire | booking_canceled | 2 to 14 days | 1 | 0 |
| Luxury | none | | 0 | |
| Must Hotel (test) | booking_canceled | 0 to 2 days | 26 | 0 |
| Must Hotel (test) | booking_update | 0 to 2 days | 31 | 0 |
| Must Hotel (test) | booking_new | 0 to 2 days | 1 | 0 |
| Must Hotel (test) | folio_update | over 60 days | 45 | 0 |

None has a reason: all were saved before 39-7a (merged 2026-11-16) started keeping one.

**Does MUST already match Clock?**

- **Empire, 1 booking_canceled:** yes. MUST shows the booking CANCELLED.
- **Empire, 837 folio_update (704 different folios):** the events are not a steady trickle. **835 of them failed on a single day, 2 October 2026** (the same day 165 other folio events worked, and later days were clean). 836 of the folios were never stored in MUST (`clock_folios`). Folio events are visibility only: the live bill checks read Clock's bill directly, so no money decision depended on these rows. The cause is **unverified** (no reason was kept); a one-day incident or the folio feature being switched on that week is the likely story.
- **Must Hotel, 26 different bookings** (each had a canceled event and an update event; the first version of this report counted them twice and said 53): **all 26 are cancelled in Clock** (read from the Clock sandbox, GET only) while **MUST still shows them CONFIRMED**. So on the test hotel the failed events left MUST out of date. A likely cause (unverified): the sandbox's request allowance was used up by the bill-check loop of gap G-30 until it was fixed on 2026-11-17, so these reads were refused.
- **Must Hotel, 45 old folio_update:** same kind as Empire's; not checked one by one.

## 2. Dead-letter queue and failed job lists (Redis)

`clock.dead-letter` holds **928 jobs** (a waiting list; nothing is processing it).

| Job name | Month | Jobs |
| --- | --- | --- |
| hydrate-event | 2026-09 | 45 |
| hydrate-event | 2026-10 | 857 |
| reconcile-payments | 2026-09 | 20 |
| reconcile-payments | 2026-11 | 1 |
| reconcile-property | 2026-09 | 2 |
| reconcile-property | 2026-11 | 1 |
| reconcile-stay | 2026-09 | 1 |
| sweep-stuck-events | 2026-11 | 1 |

857 + 45 hydrate-event jobs match the failed webhook events above (the 2 October incident and the test hotel). Every job's data holds only the original job and the reason.

Failed job lists that never age out (`removeOnFail` is off on the webhook queue):

| Queue | Failed jobs | Oldest | Newest |
| --- | --- | --- | --- |
| clock.webhooks | 883 | 2026-09-30 | 2026-11-05 |
| clock.reconciliation | 24 | 2026-09-11 | 2026-11-16 |
| mail.alerts | 2 | 2026-10-27 | 2026-11-02 |
| payment-expiry | 1 | 2026-11-02 | 2026-11-02 |

Redis uses 27.6 MB, so the old lists are untidy, not a risk.

## 3. What I recommend for step 3

| Slice | Recommendation |
| --- | --- |
| 39-7c: give old failures a final state | **Yes, for Empire's 837 folio events** (final state IGNORED if it says the right thing, rows kept as the duplicate guard): one old incident, folio rows are visibility only, bills are read live. **No, for Must Hotel's 26 bookings:** they are not consistent. First re-read those bookings from Clock (an operator retry of those events on the test hotel, with your yes), then finalise whatever is left. The 1 Empire cancellation is already consistent and can be finalised too. |
| 39-8c: remove old dead-letter jobs and trim failed lists | **Yes, but low priority.** Remove the jobs older than 30 days (that is the 45 + 20 + 2 + 1 from September and the October ones from 1 to 16 October: about 925 of the 928; confirm the exact number at run time) and trim `clock.webhooks` and `clock.reconciliation` failed lists. A live Redis change; nothing is lost that the database rows do not hold. Do it outside busy hours, after a count before and after. |
