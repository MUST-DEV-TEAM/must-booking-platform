# Master checklist: an Astro website for a client

Copy the sections that apply into the project's `docs/PLAN.md`. Mark `[x]` with the date. "NEW" marks items found missing in the 2026-11-09 review (see site-review.md).

## 0. Intake (ask the owner once, record answers in docs/PLAN.md)

- [ ] Path: new site from scratch, or rebuild of an existing WordPress site?
- [ ] Look: copy the current site, supplied design (Figma, screenshots), or a base style we already have?
- [ ] Languages at launch and later (English first; Albanian code in HTML is `sq`, URL prefix `/al`).
- [ ] Final domain, `www` or not, staging address (for the client to review before launch).
- [ ] Hosting: client's current server, MUST host, or decide later. Who owns DNS and email?
- [ ] Booking: Must-Booking API for rooms? Restaurant or other venues? Or no booking.
- [ ] Pages wanted; retired pages; offers and packages to keep or drop.
- [ ] Content source: existing site text and photos, client supplies, or we write (never invent).
- [ ] Does the client need to edit content later? If yes: a CMS (Sanity pattern in Studio Lagoo) and a short training.
- [ ] Brand: logo (vector if possible), colors, fonts and their licenses, tone.
- [ ] Facts: address, phone, WhatsApp, emails, opening dates, coordinates, social links, review sites.
- [ ] Legal: terms, privacy and cookie texts supplied by the client; company details.
- [ ] Analytics and ads wanted (Google Analytics, Meta pixel)? Only after consent.
- [ ] Animations and popups: which, if any (Luxury toolkit is the default).
- [ ] Who approves, and by when? Who gives answers during the build?

## 1. Repository and project setup

- [ ] Private GitHub repo `MUST-DEV-TEAM/<Name>-Astro`, local folder on the Desktop with the same name.
- [ ] Astro current stable, Node 22+, `output: 'static'` with the Node adapter only for API routes, `trailingSlash: 'never'`, `build.format: 'directory'`.
- [ ] `.gitignore`: node_modules, dist, `.env*`, `assets-source/` (originals), logs, output, notes.
- [ ] `.env.example` complete; `.env` for local (sandbox); `.env.production` with the real ids (ignored by Git).
- [ ] `README.md` (overview, pages, tech, integrations, run, deploy), `AGENTS.md` (rules), `docs/PLAN.md` (tasks), `docs/TODO.md` (questions).
- [ ] `docs/reference/`: copy of the Must-Booking API description so the folder is self-contained.
- [ ] `src/data/site.ts`: one file with the hotel's facts used everywhere (name, phone, address, coordinates, colors).
- [ ] `docs/SETUP-ON-A-NEW-PC.md`, `docs/MAINTENANCE.md`, `CREDITS.md` (photo and font credits and licenses).
- [ ] NEW: GitHub Actions: build, `check:build` (one h1, one main, links, JSON-LD valid), secret scanning/push protection on, Dependabot on. (None of our sites had this.)
- [ ] Commit rules: small commits, English, no secrets, no originals.

## 2. Rebuilding a WordPress site (only for migrations)

- [ ] Inventory every page from the sitemaps and `wp-json` (pages, posts, media). List: address, title, meta description, language.
- [ ] Copy the SEO plugin's titles and descriptions (Yoast/Rank Math) per page; do not lose them.
- [ ] Download the full-size originals of photos and videos (not resized copies); note what is used where.
- [ ] Redirect map `src/data/legacy-redirects.mjs`: every old address maps to a new one (301); retired pages answer 410; test all of them at the end.
- [ ] Inventory forms, plugins, scripts, tracking ids, embedded maps, chat widgets, booking plugins and what replaces each.
- [ ] Capture today's look: fonts, colors, spacing, header, footer, buttons (screenshots at 390, 768, 1440).
- [ ] Capture today's behavior worth keeping (menus, carousels, lightbox) and rebuild it, don't copy plugin code.
- [ ] Keep WordPress running until launch; launch behind a proxy switch with a rollback file.
- [ ] NEW: before retiring WordPress, export a full backup (files and database) and keep it, unless the owner explicitly says no in writing in the project notes.

## 3. Pages every site needs

- [ ] Content pages (home, about, rooms or services, gallery, contact, offers if any).
- [ ] Booking pages: search, choose, details, payment, confirmation, manage (noindex).
- [ ] Legal: terms, privacy policy, cookie policy (client's own text).
- [ ] System: 404, 500, maintenance (503). NEW: also as server-level status pages for the proxy (TIA `.htaccess` pattern), so errors show the branded page even when Node is down.
- [ ] `/components` showcase page (noindex, not in the sitemap) listing every shared component. TIA, Luxury and Lagoo have one; it keeps the UI consistent.
- [ ] Search and machine files: `sitemap-index.xml`, `robots.txt`, `llms.txt`, `manifest.webmanifest`, optional `.well-known/security.txt`.

## 4. Design system

- [ ] Tokens as CSS variables (colors, type scale, spacing, radius, shadows, motion timing) in one `global.css`.
- [ ] Fonts hosted locally as WOFF2, subset (Latin + Latin Extended for Albanian: ë, ç), `font-display: swap`, preload the main one, licenses in `public/fonts/`.
- [ ] One component set; each component documented on `/components`.
- [ ] Visible focus style, 44 px tap targets, readable contrast.
- [ ] NEW: decide dark/light behavior: the site itself usually has one theme, but icons, `theme-color`, and the maintenance/error pages must look right in both browser modes.

## 5. Search engines and AI search (SEO and GEO), per page

- [ ] Unique title (about 60 characters) and meta description (120-165), one `h1`, ordered headings.
- [ ] Canonical (no trailing slash), `hreflang` (`en`, `sq`, `x-default`), robots `index,follow` or `noindex` for booking/system pages.
- [ ] Open Graph and Twitter card with 1200x630 image and alt, locale. NEW: a per-page OG image for key pages (rooms, home), not only one default.
- [ ] Geo tags (`geo.region`, `geo.placename`, `geo.position`, `ICBM`) with coordinates from the Google Maps pin.
- [ ] JSON-LD: Hotel/LodgingBusiness + WebSite + BreadcrumbList on every page; HotelRoom, ImageGallery, ContactPoint, OfferCatalog/Service, Restaurant where they apply. Validate; keep it in one `schema.ts`.
- [ ] Facts identical everywhere (name, address, phone, email, room facts) and equal to Google Business Profile.
- [ ] Crawlable links, descriptive link text, alt text, image sizes set.
- [ ] `llms.txt` with a short factual summary and key links. No promise of AI inclusion.
- [ ] After launch: Google Search Console and Bing Webmaster (submit sitemap), request indexing of key pages, update Google Business Profile website link. NEW: IndexNow for Bing.

## 6. Icons, favicons and social images

- [ ] `favicon.ico` (16/32/48), `favicon-32.png`, `apple-touch-icon.png` (180, opaque background, iOS fills transparency with black), `icon-192`, `icon-512`, `icon-maskable-512` (logo inside the middle 60%), `manifest.webmanifest`, `og-default.jpg`.
- [ ] NEW **Dark and light mode favicon.** Browser tabs are light or dark, and a single-color mark disappears in one of them. Use both:
  - `favicon.svg` with an internal `@media (prefers-color-scheme: light|dark)` rule that flips the mark color (TIA does this), or two PNGs linked with `media="(prefers-color-scheme: dark)"` / `light` (needed when the logo is only a raster image).
  - Keep the opaque "tile" icons (`favicon.ico`, apple-touch, 192, 512) as the fallback: a logo on its own brand-colored square is visible in every mode and in Safari, which ignores the media attribute.
  - Check: Chrome light, Chrome dark, Safari, Firefox, and a bookmark/home-screen icon.
- [ ] `theme-color` meta in two versions with `media="(prefers-color-scheme: light|dark)"`.
- [ ] Add `?v=` to icon links so a change is picked up. One script (`make-icons.mjs`) rebuilds every icon from one source.
- [ ] If the logo only exists as a tiny image, ask for a vector and redo the set.

## 7. Images and video

- [ ] Originals out of Git (`assets-source/`); one script resizes (max about 1920 px, never enlarge).
- [ ] One `Photo` component: Astro image service, AVIF/WebP, srcset widths (480, 768, 1024, 1440, 1800), correct `sizes`, width/height, lazy; first screen image `priority`.
- [ ] Mobile crops for hero images when the subject is off-center (TIA keeps them).
- [ ] Budget: no photo over about 300 KB sent to a phone; check at the end.
- [ ] Video: one original becomes 1080/720/480 and a 9:16 portrait crop, each MP4 (H.264) and WebM (VP9), no sound, 30 fps, fast-start, poster image. Limit a looping background to the first 30-60 seconds.
- [ ] `<video>` muted, loop, playsinline, small preload; waits for page load and idle; pauses off-screen (TIA); no download with reduced motion or Data Saver (poster only). Never autoplay with sound.
- [ ] Alt text for every meaningful image; decorative ones get empty alt.
- [ ] Photo credits and licenses in `CREDITS.md`.

## 8. Animation and motion

- [ ] The Luxury toolkit: reveal (up, left, right, zoom), stagger, headline letters rising, ornament lines, count-up, carousel, tab indicator, link prefetch on hover.
- [ ] Pure CSS plus small scripts; no heavy libraries. Only `opacity` and `transform`.
- [ ] Everything honors `prefers-reduced-motion`; content visible without JavaScript.
- [ ] Hover effects only under `@media (hover: hover)` (a hidden wrapper once swallowed taps on phones).

## 9. Pop-ups and overlays (desktop and phone)

- [ ] Cookie consent and preferences, date picker, guest picker, room panel, gallery lightbox, WhatsApp button, form results, booking summary.
- [ ] Each has a desktop form (popover, side panel, modal) and a phone form (bottom sheet, full screen).
- [ ] Close with the button, Esc, backdrop tap and the phone back button; focus moves in and back; page behind does not scroll; `role="dialog"`, `aria-modal`.
- [ ] Do not stack the cookie sheet on top of the WhatsApp button.

## 10. Forms and email

- [ ] Contact, newsletter, enquiry forms post to a server route that sends email (not `mailto:`; TIA's form only opens the visitor's mail app, a known gap).
- [ ] Validation on both sides, honeypot field, rate limit, clear success and error states, no personal data in logs.
- [ ] SMTP from the client's account (app password) kept in the server `.env`; local dev saves to `./outbox`.
- [ ] Reply-To is the guest; From is the site address.
- [ ] NEW: deliverability: SPF, DKIM, DMARC for the sending domain; send a test and check it is not in spam.
- [ ] Test every form with the shared test inbox (`+tag` addresses) and read the result.
- [ ] Phone field with country list, numeric input; country search (we have `countries-list`).

## 11. Booking integration (Must-Booking)

- [ ] Server-only API client (`src/lib/must.ts`) with short caching and an 8 s timeout; falls back gracefully ("price unavailable", rooms list still shown).
- [ ] Rooms, photos, amenities and texts from the catalog; dates and guests from the search; live price and availability per room.
- [ ] Clock-hotel specifics: several rates per room (rate cards), crossed-out price when discounted, cancellation wording from the API.
- [ ] Rules tests (sold out, minimum stay, closed to arrival, and so on) at three levels: the room list, the room page, and a forced API call (Luxury `docs/BOOKING-TESTS.md`).
- [ ] Payment: sandbox cards only in tests; confirmation page polls the status; manage link emailed; cancel flow.
- [ ] Idempotent create, guest session cookie, no price computed on the site, currency shown as the API says (display conversions only as approximate).
- [ ] Maintenance and "Cloudflare/bot protection must not block the server's API calls" (a Bot Fight Mode rule once silently blocked all WordPress-to-API traffic).

## 12. Privacy, consent and legal

- [ ] No third-party request (fonts, maps, video, analytics, Instagram) before consent; verified in a browser test (TIA did this).
- [ ] Consent categories, withdraw anytime, remembered choice; map shown only after consent with a placeholder.
- [ ] Analytics only after consent; booking conversion events if the client wants them.
- [ ] Terms, privacy and cookie pages with the client's text and company details; list the real cookies used.
- [ ] Data we store (bookings via API, form emails) described in the privacy text.

## 13. Accessibility

- [ ] `lang` attribute right per page; skip link; landmarks; one `h1`; heading order.
- [ ] Keyboard only: menus, pickers, dialogs (focus trap, Esc), carousels, lightbox.
- [ ] Contrast checked; labels on all fields; errors read by screen readers; touch targets 44 px.
- [ ] Reduced motion; no autoplaying sound; text resizes without breaking.
- [ ] Lighthouse accessibility 100 on key pages.

## 14. Performance

- [ ] Targets (mobile Lighthouse): performance 90+, accessibility, best practices, SEO 100; CLS under 0.05.
- [ ] Inline critical CSS, small JS, fonts preloaded, hero image preloaded, prefetch on hover.
- [ ] Compression, HTTP/2, cache headers (long for hashed assets, short for HTML).
- [ ] Record results in `docs/optimization-audit.md` (TIA format), with date and tool version.
- [ ] NEW: real-user monitoring after launch (Search Console Core Web Vitals report).

## 15. Security

- [ ] Security headers at the proxy: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame protection; CSP when scripts allow (Luxury has none yet).
- [ ] Keep the headers config in the repo (`docs/` or `server-config/`) so a rebuild of the server can be done (Luxury kept them only on the server).
- [ ] Rate limits on every form and API route; honeypots; request size limits.
- [ ] Maintenance preview key compared in constant time with a keyed cookie (not a fixed `1`).
- [ ] No secrets in the client bundle; `.env` ignored; secret scanning and push protection on; dependency alerts on.
- [ ] No admin routes on the Astro site; WordPress admin kept behind its own login or removed.

## 16. Testing

- [ ] Screen sizes: 320, 390, 768, 1024, 1440, 1920 on every page: no horizontal scroll, no overflow.
- [ ] Browsers: Chrome, Firefox, Safari; real iPhone and Android once before launch (TIA never tested these).
- [ ] Build integrity check (`check:build`): one h1, one main, local links and fragments, JSON-LD valid.
- [ ] Interaction checks: menus, pickers, forms, consent, lightbox, carousel, reduced motion, video fallbacks.
- [ ] Booking tests (section 11) and a full sandbox booking, including payment and manage.
- [ ] Redirect test of every old address; 404 returns 404; maintenance returns 503 with assets loading.
- [ ] Print view of the booking confirmation reads well.

## 17. Hosting and deployment

- [ ] Server layout: `/opt/astro-site` (dist, prod node_modules, `.env`), systemd service on 127.0.0.1, Node via a fixed path; or Docker for demos.
- [ ] Proxy (Apache/Nginx) sends everything to Astro; WordPress paths kept if WordPress stays; configtest before every reload.
- [ ] SSL renewal confirmed (date and method); HTTP to HTTPS and www redirects.
- [ ] Rollback: keep the pre-switch proxy file; one command to go back.
- [ ] Maintenance mode in two layers (Node middleware and proxy); documented.
- [ ] Deploy steps written down: build locally, upload `dist`, restart the service.
- [ ] Backups of the server config and `.env`; disk space check (Luxury's disk was 100% full).
- [ ] NEW: uptime monitor and a daily check of key pages; alert goes to a person.

## 18. Launch day and the first week

- [ ] Owner approves each live step. Freeze content before the switch.
- [ ] Switch, then test: home, a room, booking search, a real booking only with the owner, forms, redirects, 404, sitemap, robots.
- [ ] Submit sitemap, check indexing of key pages, update Google Business Profile.
- [ ] Watch server logs and Search Console for 404s and errors for a week; fix redirects.
- [ ] Hand over: short document with where things are, how to update, how to roll back, who to call.

## 19. Documents to leave in the repo

- [ ] README (badges, overview, pages, tech, integrations, run, deploy), AGENTS.md, PLAN.md, TODO.md, CREDITS.md.
- [ ] SETUP-ON-A-NEW-PC.md, MAINTENANCE.md, SEARCH-LAUNCH.md, optimization notes and audit, booking tests.

## 20. Languages

- [ ] Astro i18n with `prefixDefaultLocale: false`; routes `/al/...`; HTML `lang="sq"`; `hreflang` set; language switch keeps the same page.
- [ ] English first, all translation in one pass at the end; translate slugs only if SEO benefit is clear.
- [ ] Check Albanian text for long words in buttons, menus and the booking steps at 320 px.

## 21. Optional CMS (when the client edits content)

- [ ] Sanity Studio in the repo (Studio Lagoo pattern); content types for pages, posts, projects; localized fields; project id in `.env`, no write token in the site.
- [ ] Preview before publish; webhook to rebuild; a short training video or document.

## 22. Working with Codex or other assistants

- [ ] `AGENTS.md` with the standing rules; `PLAN.md` ordered tasks; "read these two files, then do the first unchecked task".
- [ ] Per page: report "X page done" with the three screen sizes checked.
- [ ] Claude reviews each page against the live site and the checklist, and does the forgotten small things (icons, headers, redirects, docs).

## 23. After launch (ongoing)

- [ ] Dependabot pull requests reviewed monthly; Astro updates tested on a branch.
- [ ] SSL, domain and hosting renewal dates written in `docs/MAINTENANCE.md`.
- [ ] Quarterly: Lighthouse run, broken links, Search Console review, content freshness (offers, prices, photos).
