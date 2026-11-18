# Milestone 41: Frontend hardening

Status: **Planned 2026-11-14. Owner decisions recorded the same day (section 2). Nothing built. Ready to execute; the Astro launch tasks (10 and 11) are first.**

Source: [frontend review, 2026-11-13](../../audit/frontend-review-2026-11-13.md) (tasks F1 to F9, A1 to A4, W1). The task table is the spec; the review holds the evidence. The review read code and requested public pages; it did not sign in, so how the dashboard looks and feels in use is not judged yet (task 12).

## 1. Goal and limits

The staff dashboard cannot be framed or indexed by outsiders, tells a signed-out user to sign in instead of showing an empty hotel, keeps working when one part of a screen breaks, loads fast, and has browser tests on the screens that move money. The Empire Astro site launches with the same protections.

Three frontends, three places of work:

- **Dashboard** (`apps/web`, this repository): tasks 1 to 9 and 12.
- **Empire Astro site** (its own repository, `Empire-Beach-Resort-Astro`): tasks 10 and 11 are executed there and tracked in its `docs/TODO.md`; this file only lists them so nothing is forgotten at launch.
- **WordPress plugin** (being retired): security fixes only, plus task 13.

Out of scope: the dashboard's visual redesign (Milestone 24), new screens, and the API side of anything (Milestones 39 and 40).

## 2. Owner decisions (2026-11-14)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Should anyone on the internet be able to create a hotel account at `/signup`? | Yes, it stays open. Because of that, [Milestone 39 task 10](39-backend-hardening.md) (the two open security findings) moves to "now". |
| D2 | Should the staff dashboard be available in Albanian (F8)? | English only for now. |
| D3 | Fix the bare-IP link on Empire's live WordPress home page (W1)? | No. The site is being replaced by the Astro site this weekend; task 13 is dropped. |
| D4 | A change on the live proxy so browsers keep the dashboard's script files for a year (F5). | Yes, with task 6. |
| D5 | When is the Empire Astro launch planned? | The weekend of 2026-11-14 and 15. Tasks 10 and 11 are therefore first. |

The decisions approve the approach. Each merge still deploys and needs the owner's go for that task.

## 3. Rules for whoever executes

- The [Milestone 38 rules](38-database-hardening.md#3-rules-for-whoever-executes) and the two added in [Milestone 39](39-backend-hardening.md#3-rules-for-whoever-executes) apply unchanged.
- Owner's component rule: check `components/ui` first, build a missing piece as a shared component, and let pages only compose them. No one-off UI in a screen.
- Before pushing web changes: `pnpm --filter web build`, eslint on changed files, and the unit tests of every touched screen.
- A change to the live proxy or to live WordPress content is typed by the owner or done with the owner's go for that change; it is not part of a pull request.

## 4. Tasks, in execution order

| # | Task | Closes | Needs | Risk | Runs |
| --- | --- | --- | --- | --- | --- |
| 1 | Fix the flaky payments-screen test | Open follow-up 2 | - | Low | Opus |
| 2 | Security headers; internal pages and search engines kept out | F1, F2 | - | Low | Sonnet |
| 3 | A double click creates one payment link | F7 | - | Low | Sonnet |
| 4 | One API client; an expired session leads to the login page | F3 (MBA-208) | - | Medium | Opus designs, Sonnet migrates |
| 5 | A broken part of a screen does not blank the dashboard | F4 | - | Low | Sonnet |
| 6 | A lighter login page and long-lived script caching | F5 | D4 | Low-medium | Opus analyses, Sonnet applies |
| 7 | Browser tests for the money screens | F6 | Task 1; Milestone 40 tasks 1 and 2 | Low | Opus |
| 8 | Language of the dashboard | F8 | Decided: English only for now | None | - |
| 9 | Large screen files and leftover CSS modules | F9 | When a file is next changed | Low | Sonnet |
| 10 | Astro launch: visitor address behind the proxy, security headers | A1, A2 | **Before the launch this weekend**; Empire repository | Low | Sonnet |
| 11 | Astro launch: the order of steps for switching the hotel's website address | A3 | **Before the launch this weekend** | Medium | Opus |
| 12 | Look at the dashboard in use, on a computer and a phone | Review's "Not checked" | - | None (reading) | Fable |
| 13 | Empire's live home page: replace the bare-IP link | W1 | Dropped (D3) | - | - |

Tasks 10 and 11 go first, because the Astro site launches this weekend. Among the dashboard tasks, task 1 goes first because the flaky test fails pull requests that have nothing to do with it (it failed three on 2026-11-13 and 2026-11-14, each passing on a re-run). Tasks 2 and 3 are small and independent. Task 4 is the largest.

### Task 1. Fix the flaky payments-screen test

- **Where:** `apps/web/app/dashboard/payments.test.tsx`, the case "asks an owner, admin or manager to confirm a refund after the 24-hour window". In CI it fails with "Timed out waiting for the reason options" or "The node to be removed is not a child of this node" when the whole web suite runs under load, and passes alone.
- **Change:** find the state shared between tests or the missing clean-up (a portal or a timer left by the previous case is the usual cause) and fix it there. Do not raise the timeout and do not mark the test as retried: a test that passes on the second try hides the next real failure.
- **Verify:** the web suite run 20 times in a row on the CI replica with no failure.

### Task 2. Security headers; internal pages and search engines kept out

- **Found on live:** `https://booking.must.al` sends no `Strict-Transport-Security`, frame rule, `X-Content-Type-Options`, `Referrer-Policy` or `Content-Security-Policy`, and announces `X-Powered-By: Next.js` (the API: `Express`). Another site can load the dashboard in an invisible frame and trick a signed-in staff member into a click, on a screen that can refund money. `/design` and its ten sub-pages and `/signup` answer 200 to anyone; `/robots.txt` is 404.
- **Change:**
  - `apps/web/next.config.ts`: a `headers()` block with HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` and a minimal `Permissions-Policy`; `poweredByHeader: false`. Disable the Express header in the API.
  - A Content-Security-Policy in **report-only** mode first, reporting to Sentry. Enforce it in a later release, after a week without reports from real use.
  - Build the `/design` routes only in development. Add `robots.txt` with `Disallow: /` and a `noindex` meta tag.
  - `/signup` stays open (D1). It gets the same headers; `robots.txt` may allow it if the owner wants it found.
- **Check first:** that nothing legitimate frames the dashboard (the WordPress plugin or a hotel site embedding a page), so `DENY` breaks nothing.
- **Verify:** `curl -I https://booking.must.al/login` shows the headers; `/design` returns 404 on live; `/robots.txt` returns the rule; the PokPay return flow and the photos still work.

### Task 3. A double click creates one payment link

- **Where:** `apps/web/app/dashboard/checkout-link-actions.tsx:41` creates a new idempotency key on every click. The other money actions keep one key per attempt (`attempt.current`).
- **Change:** use the same per-attempt key. A unit test: two fast clicks send the same key and one link results.

### Task 4. One API client; an expired session leads to the login page

- **Found:** `apps/web/app/dashboard/dashboard-shell.tsx:401-407` turns a failed memberships or properties request into an empty list, so a signed-out staff member sees a dashboard with nothing in it. There are 204 direct `fetch` calls in 81 files, each reading errors its own way.
- **Step 1, design and first use (Opus):** one small client, `apps/web/lib/api.ts`: sends credentials, reads the API's error shape into one error type, and on 401 sends the user to the login page with the address to return to. Use it in the dashboard shell and the platform shell first, so the empty-hotel case is gone at once.
- **Step 2, migration (Sonnet):** move screens to the client a few at a time, money screens first, each pull request small enough to review. Add a lint rule that refuses a new direct `fetch` to the API outside the client once the count is low.
- **Do not change:** what any screen shows on success; idempotency keys stay with the screens.
- **Verify:** a browser test that deletes the session cookie and clicks a menu item lands on the login page, then returns to the same screen after signing in. The count of direct `fetch` calls goes in each pull request.

### Task 5. A broken part of a screen does not blank the dashboard

- **Found:** one `global-error.tsx` and nothing else: no `error.tsx`, no `loading.tsx`, no boundary. A render error in one chart replaces the whole dashboard.
- **Change:** `error.tsx` under `app/dashboard` and `app/platform`; one shared boundary component in `components/ui` that shows "this part could not load" with a retry and reports to Sentry; wrap each dashboard section in it.
- **Verify:** a test that makes one section throw still shows the menu and the other sections.

### Task 6. A lighter login page and long-lived script caching

- **Found on live:** the login page loads about 440 KB of compressed script in 16 files. Nothing is loaded on demand. Sentry Session Replay loads on every page. Hashed static files are cached for about 15 hours because the proxy overrides Next's own header.
- **Change:** run a bundle analysis and put its numbers in the pull request. Then load Session Replay, the charts, the calendar board and drag-and-drop only where they are used. With D4: `Cache-Control: public, max-age=31536000, immutable` for `/_next/static` at the proxy.
- **Related check:** Session Replay records staff screens with guest names and contacts. Confirm that Sentry's "mask all text" default is still on, and write it into the operations doc.
- **Verify:** compressed script on `/login` under 200 KB; a repeat visit downloads no script.

### Task 7. Browser tests for the money screens

- **Found:** 160 unit test files and 4 browser tests (sign-in, booking-mode settings, calendar blocking, the guest journey). No browser test collects a payment, refunds, cancels, edits a reservation, manages staff or opens the platform console.
- **Change:** browser tests on the isolated stack with mocked providers for: collect a payment by link and by cash, a full and a partial refund, a cancellation with and without a refund, and the session-expiry case of task 4. Write the refund and cancellation cases after Milestone 40 tasks 1 and 2, so they pin the corrected behaviour, not today's.
- **Verify:** the browser job stays under its current time limit and passes 10 times in a row.

### Task 8. Language of the dashboard

Decided 2026-11-14: English only for now. If Albanian is wanted later, the translation layer is its own milestone; every screen added before then makes it larger.

### Task 9. Large screen files and leftover CSS modules

`staff.tsx` (2,010 lines), `add-reservation.tsx` (1,727), `emails.tsx` (1,399), `reservations-page.tsx` (1,346) and `calendar-board.tsx` (1,143) each hold a whole screen; 17 CSS-module files remain beside Tailwind. Not a task of its own: when one of these files is changed for another reason, split it or convert it in the same pull request.

### Task 10. Astro launch: visitor address behind the proxy, security headers

In the Empire Astro repository, before launch:

- **Request limit (A1):** the booking endpoint counts 10 attempts per 10 minutes per visitor address. Behind a proxy that address can be the proxy's own (every guest then shares one counter) or come from a header a visitor can forge (the limit can then be bypassed). On staging, send requests through the real proxy, log the address the server sees, and configure the proxy and Astro so it is the visitor's. Verify with two networks and a forged `X-Forwarded-For`.
- **Headers (A2):** HSTS, `nosniff`, a frame rule and `Permissions-Policy` at the proxy.
- **Later (A4):** add a formatter in one commit that changes nothing else.

### Task 11. Astro launch: switching the hotel's website address

- **Why:** a hotel has one `public_website_origin` in MUST, and the payment provider returns the guest to it. During the move from WordPress (`new.empirebeachresort.al`) to Astro only one site can be the registered address.
- **Deliverable:** a written order of steps for launch day, rehearsed on Must Hotel first: change the address, make one paid test booking and check the return page, the emails' links and the Manage booking link; the rollback is the same steps backwards. Include what happens to bookings whose emails already carry the old address, and the reminder to take a full WordPress backup before the old site is removed.

### Task 12. Look at the dashboard in use

- **What:** the part the review could not do. On the local stack with the test hotel, signed in: go through the main staff tasks (find a booking, create one, take a payment, refund, cancel, change prices and availability, the calendar, staff and settings) on a computer and on a phone-sized screen.
- **Deliverable:** a short ranked list added to this file: what is confusing, slow, broken on a phone, or inconsistent between screens. Reading and clicking only; fixes become tasks.

### Task 13. Empire's live home page: replace the bare-IP link

- **Found on live:** the home page of `new.empirebeachresort.al` links to `http://18.185.56.94/booking/`: no HTTPS, no domain. A guest who follows it gets a browser warning.
- **Dropped (D3):** the WordPress site is replaced by the Astro site this weekend. If the launch slips by more than a few days, reconsider: the fix is one link.

## 5. Done when

- `booking.must.al` sends the security headers, and `/design` is closed.
- A signed-out staff member lands on the login page and comes back to the same screen.
- One broken chart leaves the rest of the dashboard usable.
- The login page loads under 200 KB of script, and a repeat visit loads none.
- Collecting, refunding and cancelling have browser tests, and the web suite passes 20 times in a row.
- The Astro launch checklist holds the proxy, header and address-switch steps, rehearsed on the test hotel.
- The dashboard has been looked at in use, and what was found is listed.
