# Frontend review, 2026-11-13

Step 3 of the layered review. Earlier steps: [database](database-review-2026-11-13.md), [backend](backend-review-2026-11-13.md). This file is the task list for the models that execute the work.

**Scope.** Three frontends exist:

1. The staff and platform dashboard (`apps/web`, Next.js 16, about 85,000 lines), live at `booking.must.al`.
2. The guest website. The owner is moving from the WordPress plugin to Astro sites. The Empire Astro site (`Desktop/Empire-Beach-Resort-Astro`, its own repository) is built and tested locally and not launched.
3. The WordPress plugin (`apps/wordpress-plugin`), still serving Empire's live site until the Astro launch. It was not reviewed in depth because it is being retired.

**How it was checked.** Code was read and counted. The live dashboard and Empire's live home page were requested without signing in (headers, page weight, public routes). Nothing was changed. No screen behind the login was opened, so this review does not judge how the dashboard looks or feels in use.

## Ranked tasks

| # | Task | Priority | Risk of the fix | Who runs it |
| --- | --- | --- | --- | --- |
| F1 | The dashboard sends no security headers | Now | Low | Sonnet |
| F2 | Internal design pages and sign-up are public; no robots rule | Now | Low | Sonnet, one owner answer |
| F3 | An expired session looks like an empty hotel | Soon | Medium | Opus designs, Sonnet migrates |
| F4 | One broken widget blanks the whole dashboard | Soon | Low | Sonnet |
| F5 | The login page loads about 440 KB of compressed script | Soon | Low-medium | Opus analyses, Sonnet applies |
| F6 | Browser tests cover no money screen | Soon | Low | Opus |
| F7 | A double click can create two payment links | Soon | Low | Sonnet |
| F8 | Dashboard is English only | Owner decision | Large if wanted | - |
| F9 | Very large screen files and leftover CSS modules | When next touched | Low | Sonnet |
| A1 | Astro: test the request limit behind the real proxy | Before Astro launch | Low | Sonnet |
| A2 | Astro: security headers at the proxy | Before Astro launch | Low | Sonnet |
| A3 | Astro: plan the switch of the hotel's website address in MUST | Before Astro launch | Medium | Opus |
| A4 | Astro: very long code lines | Later | Low | Sonnet |
| W1 | Empire's live home page links to a bare IP address | Now (live today) | Low | Sonnet, owner go |

## Dashboard (`apps/web`)

### F1. The dashboard sends no security headers

- **Found on live:** `https://booking.must.al` returns no `Strict-Transport-Security`, `X-Frame-Options` or frame rule, `X-Content-Type-Options`, `Referrer-Policy` or `Content-Security-Policy`. It does return `X-Powered-By: Next.js`, and the API returns `x-powered-by: Express`. Without a frame rule another site can load the dashboard inside an invisible frame and trick a signed-in staff member into clicking, on a screen that can refund money.
- **Change:** add a `headers()` block in `apps/web/next.config.ts` (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`); set `poweredByHeader: false`; disable the Express header in the API. Add a Content-Security-Policy in report-only mode first.
- **Verify:** `curl -I https://booking.must.al/login` shows the headers after deploy.

### F2. Internal design pages and sign-up are public; no robots rule

- **Found on live:** `/design` and its ten sub-pages (including `/design/pokpay-checkout`) answer 200 to anyone. `/signup` also answers 200. `/robots.txt` is 404 and pages carry no `noindex`, so search engines may list the dashboard's pages.
- **Change:** build the `/design` routes only in development (the Empire Astro site already does this for its component pages). Add `robots.txt` with `Disallow: /` and a `noindex` meta tag.
- **Question for the owner:** should anyone be able to create a hotel account at `/signup` today? If not, close it. If yes, backend task B9 (two open security findings) moves to "now".
- **Verify:** `/design` returns 404 on live; `/robots.txt` returns the rule.

### F3. An expired session looks like an empty hotel

- **Found:** the dashboard shell (`apps/web/app/dashboard/dashboard-shell.tsx:401-407`) turns a failed memberships or properties request into an empty list, so a staff member whose session expired sees a dashboard with nothing in it. The platform console handles 401; the hotel dashboard has no shared handling. There is no shared API client: 204 direct `fetch` calls in 81 files each parse errors their own way. This matches the older finding MBA-208.
- **Change:** one small client (`apps/web/lib/api.ts`) that sends credentials, parses the API's error shape, and on 401 sends the user to the login page with a return address. Move screens to it one at a time.
- **Verify:** a browser test that deletes the session cookie and clicks a menu item lands on the login page, then returns to the same screen after signing in.

### F4. One broken widget blanks the whole dashboard

- **Found:** the app has one `global-error.tsx` and no other error boundary: no `error.tsx`, no `loading.tsx`, no `ErrorBoundary`, no `Suspense`. A render error in one chart or table replaces the entire dashboard with the global error page.
- **Change:** add `error.tsx` under `app/dashboard` and `app/platform`, and wrap each dashboard section in a boundary that shows "this part could not load" with a retry.
- **Verify:** a test that makes one section throw still shows the menu and the other sections.

### F5. The login page loads about 440 KB of compressed script

- **Found on live:** the login page pulls 16 files; the two largest are 165 KB and 155 KB compressed. Nothing in the app is loaded on demand (no dynamic imports). Sentry Session Replay is loaded on every page. Hashed static files are cached for about 15 hours, not marked immutable; the proxy overrides Next's own header.
- **Change:** run a bundle analysis first. Then load Session Replay, charts, the calendar board and drag-and-drop only where used. Set `Cache-Control: public, max-age=31536000, immutable` for `/_next/static` at the proxy (a live proxy change, needs the owner's go).
- **Verify:** compressed script on `/login` under 200 KB; a repeat visit downloads no script.
- **Related check:** Session Replay records staff screens that show guest names and contacts. Sentry masks all text by default; confirm that default is still on and write it down.

### F6. Browser tests cover no money screen

- **Found:** there are 160 unit test files, which is good. There are 4 browser tests: sign-in, booking-mode settings, calendar blocking and the guest journey. Collecting a payment, refunding, cancelling, editing a reservation, staff management and the platform console have none. One payments unit test is known to be flaky (open follow-up 2).
- **Change:** browser tests for collect payment, refund and cancel, using mocked providers on the isolated test stack.

### F7. A double click can create two payment links

- **Found:** `apps/web/app/dashboard/checkout-link-actions.tsx:41` creates a new idempotency key on every click. Other money actions reuse one key per attempt (`attempt.current`), so a repeat is safe; this one is not.
- **Change:** use the same per-attempt key pattern. Confirm with a test that two fast clicks create one link.

### F8. Dashboard is English only (owner decision)

The dashboard has no translation layer, while the guest site has English, Albanian and Italian. If Albanian staff screens are wanted, decide before many more screens are built, because every screen added now makes it larger.

### F9. Very large screen files and leftover CSS modules

`staff.tsx` (2,010 lines), `add-reservation.tsx` (1,727), `emails.tsx` (1,399), `reservations-page.tsx` (1,346) and `calendar-board.tsx` (1,143) each hold a whole screen. 17 CSS-module files (3,443 lines) remain beside Tailwind. Split and convert a file when it is next changed; this is not a task on its own.

### Dashboard: verified healthy

- Code quality is high: 1 use of `any`, no ignored type errors, no disabled lint rules, no `console` calls, no raw HTML injection.
- Shared components are used almost everywhere: 12 raw `<button>` tags and 1 raw `<input>` outside the design pages.
- 68 of 72 screens that load data show an error state.
- Money actions carry idempotency keys (except F7).
- Pages are compressed and the API is only reached through the same-origin proxy.
- Background refresh uses React Query intervals (10 to 60 seconds), which pause in hidden tabs.

## Guest website: Empire Astro site

The site is well built and well documented. Its own `docs/quality-report.md` records 81 pages in three languages, accessibility scans passing on 60 page cases, a mobile Lighthouse score of 80 accepted by the owner, and regression tests for booking reads, submission, idempotency and uncertain results. The booking endpoint (`src/pages/api/book.ts`) checks the request origin, uses a honeypot and a timing trap, limits attempts, validates every field on the server, keeps the booking switch off by default, and tells the guest not to resubmit when the result is uncertain. Its open launch items are already in its `docs/TODO.md`. Four additions:

### A1. Test the request limit behind the real proxy

- **Found:** `rateLimited` (`src/lib/mail.ts:53`) counts in memory per visitor address (`clientAddress`): 10 booking attempts per 10 minutes. Behind a reverse proxy that address can be the proxy's own, in which case every guest shares one counter and the eleventh attempt in ten minutes from anyone is refused. If the address is taken from a forwarded header without checks, the limit can be bypassed instead. Which one applies was not tested.
- **Change:** on staging, send requests through the real proxy and log the address the server sees. Configure the proxy and the Astro `security` settings so it is the visitor's address.
- **Verify:** two different networks get separate counters; a forged `X-Forwarded-For` does not reset the counter.

### A2. Security headers at the proxy

The site sets `Referrer-Policy` on the confirmation and manage pages only; the rest is an unchecked row in `docs/SITE-CHECKLIST.md`. Set HSTS, `nosniff`, a frame rule and `Permissions-Policy` at the proxy at launch.

### A3. Plan the switch of the hotel's website address in MUST

A hotel has one `public_website_origin` in MUST, and the payment provider returns the guest to that address. During the switch from WordPress (`new.empirebeachresort.al`) to Astro, only one site can be the registered origin. Write the order of steps (address change, payment return test on the test hotel, rollback) before launch day.

### A4. Very long code lines

199 lines in `src` are longer than 400 characters. The code works, but changes are hard to review line by line. Add a formatter after launch, in one commit that changes nothing else.

## WordPress plugin (being retired)

Not reviewed in depth. Keep it to security fixes until Empire's Astro launch. After the launch, a backend clean-up task can remove what only the plugin uses (pairing codes, the release-token pipeline).

### W1. Empire's live home page links to a bare IP address

- **Found on live today:** the home page of `new.empirebeachresort.al` contains a link to `http://18.185.56.94/booking/`: no HTTPS, no domain, not behind Cloudflare. A guest who follows it sees a browser warning or an insecure page.
- **Change:** replace the link with `https://new.empirebeachresort.al/booking/` in the WordPress content. This is a live content change and needs the owner's go.
- **Also seen:** the home page took 1.1 to 2.0 seconds to start answering and is not cached by Cloudflare. The Astro site removes this problem.

## Not checked

- How the dashboard looks and behaves in use (no sign-in was made). A visual and task-based review on the local stack with the test hotel is still open.
- The dashboard on a phone. 64 of 133 dashboard files use responsive classes; that is a count, not a test.
- The WordPress plugin's code.
- The other Astro sites.
