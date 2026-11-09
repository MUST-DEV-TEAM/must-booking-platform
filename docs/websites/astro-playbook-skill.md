---
name: astro-hotel-website
description: Use when starting, planning, migrating or reviewing a website built with Astro for MUST-DEV-TEAM clients (hotels, restaurants, studios), whether from scratch or rebuilt from an existing WordPress site. Gives the intake questions, build order and the master checklist so the owner never has to list what to do. Trigger on "new website", "make this WordPress site in Astro", "Astro site", "launch checklist", "did we forget anything on the site".
---

# Astro website playbook (MUST-DEV-TEAM)

Built from the review of our own sites on 2026-11-09: Luxury Premium Finese (live), Empire Beach Resort (in build), TIA (ready, not live), Studio Lagoo (CMS demo), Must Hotel Demo, Must Restaurant Demo. Details of what each site did well or missed are in [references/site-review.md](references/site-review.md). The full checklist is [references/CHECKLIST.md](references/CHECKLIST.md). How a website must work with the MUST booking system (calendar, prices, payment, errors, with acceptance tests) is in the Must-Booking repository: `docs/websites/connection-guide.md` (Part 1 for people, Part 2 for AI). Read it before touching any booking screen. GitHub copies of these files live in `docs/websites/` of the Must-Booking repository; keep the local skill and those copies in step.

## How to use this skill

1. **Intake.** Before any work, ask the owner the questions in section 0 of the checklist that are not already answered (use AskUserQuestion, rounds of four, multiple choice with a recommended option). Never ask what the repo or the live site already shows.
2. **Choose the path.** From scratch, or migration of a WordPress site (section 2 of the checklist applies on top).
3. **Set up locally first.** Create the project folder on the Desktop, git repo, `AGENTS.md`, `docs/PLAN.md` (task list written from the checklist), `docs/TODO.md` (questions for the owner), the copied reference docs, optimised media, icons and the facts file. The owner then hands the folder to Codex or ChatGPT; Claude reviews and does the small forgotten things.
4. **Run the checklist, don't re-invent it.** Tick sections off in `docs/PLAN.md`. At the end run the review part (section 16 to 19) and report what is done, what is not and why.
5. **After a site is finished,** add anything new we learned to `references/CHECKLIST.md` and `references/site-review.md` so the next site starts better.

## Standing rules (owner decisions)

- Copy the existing look when migrating; never redesign unless the owner asks.
- Never invent content: text, prices, reviews, photos, legal texts. Missing content goes to `docs/TODO.md` as a question.
- English first, translate last (Albanian, Italian) in one pass at the end.
- Build pages first; do once-only checks (production build size, sitemap, llms.txt, photo pruning, final SEO sweep) at the end. Per page still do the three screen sizes and the visual check.
- Prices and availability come from the Must-Booking API only; the site never calculates money.
- Secrets never in Git. Local work uses the "Must Hotel" sandbox, never the client's real account. No test bookings on real accounts.
- Components only: pages compose shared components.
- Live-server changes need the owner's approval each time. Keep a rollback.
- Long jobs run in the background with a short "X done" message per page.
- Use the shared test inbox for email tests (`mustbackupstorage+<project>-<case>@gmail.com`, see the personal instructions).

## What to deliver to the owner at the end

A short report in plain language: pages done, checks passed (with numbers), what is still open, what needs the owner (content, accounts, approvals), and the rollback.
