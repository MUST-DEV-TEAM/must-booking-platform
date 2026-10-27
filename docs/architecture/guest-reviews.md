# Guest reviews

Status: implemented on branch `feat/batch-oct27` (2026-10-27), not merged. Reviews are **collected for the hotel only**; publishing them (website, review sites) is a later decision.

## Flow

1. The post-stay email already goes out a set number of days after check-out (notification topic `post_stay`, default 1, set per hotel). When it is sent, `GuestReviewService.invite` makes a private link for that stay and the email gets a "Rate your stay" button above any Google/Tripadvisor buttons.
2. The link opens `/review?tenant=...&property=...&token=...` (public page, no login). The guest gives an overall score (required) and optionally scores Cleanliness, Staff, Location, Comfort, Food and Value for money, plus a comment of up to 2,000 characters. They then see a thank-you page. The owner is not emailed.
3. Staff see the results in Reports, tab **Guest reviews** (permission `reports.view`): overall average, category averages, and every review with guest and reservation links. A reservation page shows its own review (permission `bookings.view`).

## Rules

- **One review per stay.** `guest_reviews` has a unique booking; a second submit is refused. Two submits at once: only the first updates the row.
- **The link is the credential.** A 32-byte random token goes in the email; only its SHA-256 is stored. Missing, wrong and unknown links get the same answer. Links expire after 60 days (`REVIEW_LINK_VALID_DAYS`). The invitation is created only when the email has not been sent yet, because a new link replaces an unused earlier one.
- **Public endpoints** (`GET/POST tenants/:t/properties/:p/reviews?token=`) are rate limited like the booking manage page, send `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.
- **Who is invited:** confirmed stays that are not no-shows, with an email of their own (not a booking channel's masked address). PMS (Clock) reservations are included.
- **Data:** table `guest_reviews` (RLS by tenant and property), migration `20261027050000_guest_reviews`.

## Not built yet

Publishing reviews, replying to a review, moderation, and reminders for guests who do not answer.
