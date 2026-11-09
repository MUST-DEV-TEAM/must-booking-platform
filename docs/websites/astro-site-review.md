# Review of our Astro sites (2026-11-09)

Read-only review of the six local projects against the master checklist. "Gap" means the item is missing in that repository today.

## Across all sites

- **No automatic checks:** none of the six repositories has GitHub Actions, Dependabot or a secret-scanning setup of its own. (The Must-Booking platform repo has CI; the websites do not.)
- **No light/dark favicon** except TIA. Luxury and Empire use an opaque brand tile, which is visible in both modes but not the cleanest option.
- **Server config kept outside Git:** Luxury's Apache performance and security headers live only on the server; TIA keeps them in the repo (`public/.htaccess`).
- **Browser coverage:** nobody has tested Safari, Firefox or a real phone before launch (TIA says so itself).
- **Per-page social images:** every site uses one default image (or none).

## Luxury Premium Finese (live since 2026-11-04)

Good: full page set including 404, 500, maintenance; three languages; cookie consent; booking flow with sandbox and rules tests (`BOOKING-TESTS.md`); two-layer maintenance mode; JSON-LD with Hotel, HotelRoom, ImageGallery, OfferCatalog; geo tags; sitemap plus room sitemap; `llms.txt`; manifest and icon set; hero video in four sizes and two formats; image and video scripts; documentation (SETUP-ON-A-NEW-PC, MAINTENANCE, SEARCH-LAUNCH, TODO).
Gaps: no CI or Dependabot; no light/dark favicon; no CSP and headers only on the server; no `check:build` integrity script; no Lighthouse record file; maintenance preview cookie was a fixed value (fixed in Empire, **still open in Luxury**); SMTP still on the test mailbox (open item); Instagram not connected; Albanian and Italian copy done page by page.

## Empire Beach Resort (in build)

Good: plan, rules, icons and manifest, optimised photos, hero video, hotel facts file, copied API description, maintenance fix, own repo.
Gaps (all in the build plan): no pages yet, no layout with SEO, no JSON-LD, no `robots`, no CI, no light/dark favicon (fixed 2026-11-09 in the same session), no `check:build`.

## TIA (private terminal website, ready, not live)

Good: the best optimisation work: local WOFF2 fonts with licenses, AVIF and WebP at several widths, mobile hero crops, desktop and portrait film with idle-load, pause off-screen and Data Saver handling; `prepare-styles` shrinks shared CSS; `audit-build.mjs` checks one h1, one main, local links, fragments and JSON-LD; Lighthouse results recorded in `optimization-audit.md` (89-96 mobile, 100 others); full browser matrix (320 to 1920); consent before map and any third party, verified; `.htaccess` with status pages, headers, cache and compression; light/dark SVG favicon; `/components` showcase; `check:build` script; image credits and design references.
Gaps: no sitemap integration in the Astro config (a static `sitemap.xml` only, check it is current); the contact form only opens the visitor's email application; no CI; no i18n; Safari, Firefox and real phones untested; not deployed, so hosting is unverified.

## Studio Lagoo (architecture studio, CMS demo)

Good: Astro with Sanity (Studio in the repo), localized content types (English, Albanian, Italian), blog, projects with filters and a case-study template, press and awards, `PROJECT-BRIEF.md` and `SANITY_SETUP.md`, `/components` page.
Gaps: no favicon files, no `robots.txt`, no sitemap, no JSON-LD, no analytics or consent, no docs folder, no media pipeline script, no CI.

## Must Hotel Demo and Must Restaurant Demo (sandbox demos)

Good: Dockerfile and compose for deployment, server proxy with security headers, tests (jsdom), booking, payment, confirmation, manage pages; Swiper carousel.
Gaps (acceptable for noindex demos, but reuse the patterns before copying to a client): no sitemap, robots, social image, JSON-LD, theme-color; only an SVG favicon; no docs folder.

## What to reuse from which site

| Need | Take it from |
| --- | --- |
| Booking pages, API routes, language system, schema, consent, maintenance, video script, icon script | Luxury |
| Image pipeline (AVIF/WebP, mobile crops), video lazy-load, build audit, Lighthouse record, `.htaccess`, light/dark SVG favicon, fonts with licenses | TIA |
| CMS (Sanity), blog, projects, localized content model | Studio Lagoo |
| Docker deployment, sandbox payments, restaurant landing | Must demos |
| Plan, AGENTS.md rules, self-contained folder, `site.ts` facts, dark/light PNG favicon pair | Empire |
