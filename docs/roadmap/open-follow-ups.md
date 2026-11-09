# Open follow-ups (recorded 2026-11-09)

Things found or agreed during the 2026-11-09 working session that are not done yet. Each row says where the detail lives. Remove a row when it is done.

## Main project (MUST booking system)

| # | Follow-up | Where the detail is |
| --- | --- | --- |
| 1 | **Reconcile [Milestone 27](milestones/27-clock-rates-cancellation-permissions.md) and [28](milestones/28-release-and-cutover.md) with what is built.** The redesigned dashboard has been live since 2026-10-26, but both files still say "Planned" and "merge on hold". Update every row's status from the code and the live site, then close what is finished. This is step 1 of the agreed overall order in the [roadmap](README.md). | Roadmap "Overall order agreed 2026-11-09" |
| 2 | **Fix the flaky web tests of the payments screen** (`apps/web/app/dashboard/payments.test.tsx`). In CI they fail with "The node to be removed is not a child of this node" when the whole web suite runs under load, and pass on re-run or alone (19 of 19 locally). It blocked pull requests #444 and #445 several times. Find the missing cleanup between tests (or the shared state) and fix it. | [Milestone 31](milestones/31-pipeline-and-connector.md) (pipeline) |
| 3 | **Restaurants, [Milestone 33](milestones/33-venues-restaurants.md).** The Q&A is answered and 22 tasks are proposed in four phases. Nothing is scheduled or built. Start with Phase A (finish stage 1). | Milestone 33 |
| 4 | **MUST booking emails: add a DMARC record** for the sending domain `mail.dejvis.dev` (SPF and DKIM through Resend are already correct). Later, consider a hotel-branded sender per hotel (see [Milestone 22](milestones/22-email-notifications.md)). | This file |
| 5 | **Branches that are not from the 2026-11-09 session** exist locally (`docs/m27-cancel-zero-balance`, `docs/m36-paysera-payment-methods`, `feat/pokpay-go-live-switch`). Merge or close them so only `main` and the working branch remain. | Owner's rule: as few branches as possible |

## Websites (see [docs/websites](../websites/README.md))

| # | Follow-up | Where the detail is |
| --- | --- | --- |
| 6 | **Empire website in Astro** ([Milestone 32](milestones/32-empire-astro-website.md)): Codex is building it from `docs/PLAN.md` in the Empire repository. Claude reviews each page against the plan, the checklist and the connection guide. Open questions: the hotel email address, the region code, what "Sanur" is, room-page mapping, legal texts. | Empire repo `docs/TODO.md` |
| 7 | **Empire plan additions:** a per-page social-share image for key pages; a staging address for the client to review before launch (a password-protected subdomain, one DNS record from the owner); a server-level error page; an uptime check (scheduled GitHub check that opens an issue). | [astro-playbook-checklist.md](../websites/astro-playbook-checklist.md) sections 3, 5, 17 |
| 8 | **Luxury Premium Finese:** the new maintenance cookie and light/dark tab icon are merged but **not deployed**; deploy with the owner's approval. Save the server settings (Apache vhost, `astro-perf.conf`, the `astro-site` service file, without secrets) into the repository: needs the right SSH key for the server (the saved connection has none). Luxury's SMTP still uses the test mailbox. | Luxury repo `docs/` |
| 9 | **TIA website** has never had a first commit (everything is untracked). Commit it, then add the same CI and Dependabot as the other sites. | [astro-site-review.md](../websites/astro-site-review.md) |
| 10 | **Email setup for the hotel domains:** enable Google DKIM for `empirebeachresort.al` (no record found at the default selector); `luxurypremiumfinese.com` does not list Google in its SPF, so mail sent through Gmail from a hotel address could land in spam. | This file |
| 11 | **Search Console and Bing Webmaster** for each site at launch: needs the owner's Google and Microsoft accounts. Claude prepares the sitemap and the exact steps. | Checklist section 5 |
| 12 | **Cross-browser and real-device test** (Firefox, Safari-style rendering, a real iPhone and Android) once the Empire pages exist. | Checklist section 16 |
| 13 | **Reminders for the owner:** take a full WordPress backup before any WordPress site is deleted or replaced (Luxury had an UpdraftPlus set). Studio Lagoo is paused until the owner focuses on it. | Checklist section 2; Claude memory |
