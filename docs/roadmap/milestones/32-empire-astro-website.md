# Milestone 32: Empire Beach Resort website in Astro

Status: **Opened 2026-11-09. Scaffold done; the build follows the plan in the website's own repository.** The site is built by Codex or ChatGPT from Claude's plan, with Claude handling the small things that are easy to forget.

## Goal

Empire Beach Resort gets a fast website built with Astro, in its own GitHub repository (`MUST-DEV-TEAM/Empire-Beach-Resort-Astro`, private), the same way Luxury Premium Finese was built. It replaces the WordPress pages of `new.empirebeachresort.al`, keeps the same look, and books rooms through the [public guest API](../../architecture/public-guest-api.md). Empire stays a Clock PMS hotel; nothing changes for its staff.

## Owner decisions (2026-11-09)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Look | **Same as today's Empire site.** Rebuilt in Astro, not redesigned. This replaces [Milestone 31](31-pipeline-and-connector.md) decision 5 ("the current look is final, nothing switches") only for the website itself: the look stays, the technology changes. |
| 2 | Languages | English first, Albanian at the very end. |
| 3 | Hosting | Empire's current WordPress server: Astro runs as a service, Apache sends visitors to it, as on the Luxury server. WordPress stays for admin until the owner retires it. |
| 4 | Where the work lives | The website is its own repository. This milestone only tracks progress and decisions. The task list and rules are in that repository's `docs/PLAN.md` and `AGENTS.md`. |
| 5 | Local first | The project is set up on the owner's computer (`Desktop\Empire-Beach-Resort-Astro`) so the owner can hand it to Codex. The GitHub repository is created when the owner says so. |

## Tasks

The detailed task list is `docs/PLAN.md` in the website repository. Summary:

| # | Task | Status |
| --- | --- | --- |
| 1 | Scaffold: Astro, booking client, mail, sitemap, plan and rules | **Done 2026-11-09** (local; builds) |
| 2 | Look and feel, shared components | Planned |
| 3 | Home, accommodation, Sanur, About, Gallery | Planned |
| 4 | Contact, legal pages, error pages | Planned |
| 5 | Booking flow through the API | Planned |
| 6 | SEO and structured data | Planned |
| 7 | Albanian | Planned |
| 8 | End-of-project checks (once) | Planned |
| 9 | Launch on Empire's server with a tested rollback (owner approval at each live step) | Planned |

## Open questions (also in the website's `docs/TODO.md`)

Final public address; the "adults only" and opening-date wording; what "Sanur" is; mapping of the live room pages to Clock room types; legal texts; contact email and SMTP details.

## Depends on / related

[Milestone 26](26-public-api.md) (the API this site books through; its TypeScript client task may reuse this site's booking code), [Milestone 31](31-pipeline-and-connector.md) (the WordPress connector keeps serving Empire until launch, and the Astro kit task there is based on this site), [Milestone 33](33-venues-restaurants.md) (Sanur may become a venue).
