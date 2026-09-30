# Milestone 23: Room photo library and Empire photo import

Status: **Planned — scoped 2026-09-30. Code for Tasks 2-3 exists in the working tree but is uncommitted, undeployed and its migrations have not been run against a database.**
Runs as an authorized ad hoc track alongside Milestone 22 (email). It does not renumber the main sequence, and the email track is deliberately out of scope here.

## Goal

1. Room types have a photo gallery and exactly one selectable main image.
2. Each property has a **photo library**: upload once, reuse across room types.
3. The real Empire Beach Resort photos (local folder `Empire-room-images-2026-03-27-to-04-01`) are imported into the live system with their main images chosen.

## Why now

Live room types have no photos at all (public catalog, 2026-09-30). Object storage (Cloudflare R2) is **not configured on the new host** — `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are all missing from its `.env` — and the API log already shows failed upload attempts (`R2_ACCOUNT_ID must be configured`).

## Decisions (owner answers 2026-09-30)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Main image per room | First (lowest-numbered) photo in each folder; owner adjusts afterwards in the dashboard |
| 2 | 167 loose photos | Library only, deduplicated against folder photos; attached to rooms later by the owner |
| 3 | R2 bucket | Does not exist yet; owner creates it (see Task 1) |
| 4 | Folders with no dedicated room type | "Standard Double room" is the only live type without a folder. Owner said to add the two unmatched folders "at the moment". **Working assumption:** both "Direct Pool Access" folders go to "Standard Double room with direct pool entrance" and "Standard Double Room With Garden & Sea View" goes to "Standard Double room". Easy to change later because photos live in the library. **Confirm before the real import run.** |

## Folder → live room type mapping (proposed)

| Local folder | Live room type |
| --- | --- |
| Deluxe Suite | Deluxe Suite Sea View |
| Deluxe Suite with Jacuzzi | Deluxe Room - Jackuzzi: Garden Entrance |
| Duplex Suite | Duplex Suite: Garden Entrance |
| Executive Suite | Executive Suite Sea View |
| Junior Suite | Junior Suite Sea View |
| Standard Double Room with Mountain View (8) | Standard Double Mountain View |
| Standard Double Room with Side Sea View (8) | Standard Double Side Sea View |
| Standard Double Room with Pool Sea View & Balcony (5) | Standard Double Pool & Sea View |
| Standard Double Room with Pool View | Standard Double pool sea view no balcony |
| Standard Double Room with Garden Sea View & Balcony | Standard Double Garden Sea View |
| Standard Double Room with Garden Sea View | Standard Double garden sea view no balcony |
| Standard Twin Room with Mountain View + Twin Room with Mountain View | Standard Double/Twin room |
| Standard Double Room with Direct Pool Access + … & Balcony | Standard Double room with direct pool entrance (assumption 4) |
| Standard Double Room With Garden & Sea View | Standard Double room (assumption 4) |

Deluxe Suite and Junior Suite share two identical files (same content hash): store once, link to both.

## Tasks

| # | Task | Owner | Status |
| --- | --- | --- | --- |
| 1 | **Create the R2 bucket.** Cloudflare dashboard → R2 → create bucket (e.g. `must-booking-photos`); enable public access (custom domain such as `photos.must.al`, or the `r2.dev` URL); add a **CORS rule** allowing `PUT` from `https://booking.must.al` (browser uploads go straight to R2 and fail without it); create an API token with Object Read & Write on that bucket; add a Cloudflare **Cache Rule** for the photo host (cache everything, 1-year edge and browser TTL). | Owner | Open |
| 2 | **Configure R2 on the new host.** Add the five `R2_*` variables to the host `.env` (owner adds the secret directly; never pasted in chat), recreate the API container, verify a real upload + public URL load. | Owner + Claude | Blocked by 1 |
| 3 | **Library + main image feature.** Property library (`property_library_images`), gallery "Choose from library", single-tile main-image picker, "Manage library". Implemented in the working tree; includes the race fix (library rows locked `FOR SHARE` on attach). | Claude | Code done, unreviewed, uncommitted |
| 4 | **Prove the migrations.** Done 2026-10-01 on a throwaway `postgres:17-alpine` container (same major version as production): all migrations apply cleanly from empty, including `20260929100000`, `20260929110000`, `20260930130000`. The library migration was then re-run over seeded legacy data: a photo shared by two room types became one library row, a URL-only image was excluded, backfilled rows are confirmed, re-running is idempotent. Row-level security verified as the `must_booking_app` role (no tenant context sees 0 rows, own tenant sees its rows, other tenant sees 0, cross-tenant insert blocked). **Not covered:** a restored copy of the real production database (data volume, unexpected legacy rows). | Claude | Done on scratch DB; production-copy rehearsal optional |
| 5 | **Hardening before deploy.** (a) Long-lived caching: keys are unique per upload, so add a Cloudflare Cache Rule on the photo host (cache everything, edge + browser TTL 1 year) instead of signing a `Cache-Control` header into every presigned URL (avoids a storage-contract change and extra CORS headers). (b) **Two-phase upload, implemented:** a library row is unpublished until `POST /image-library/:id/confirm` verifies the file exists in storage (HEAD on its public URL); unconfirmed rows older than 1 hour are purged when the library is listed; attach requires a confirmed row. (c) Picker tests added (web 5, API 3 new). | Claude | (b), (c) done in working tree; (a) is an owner Cloudflare setting, add to Task 1 |
| 6 | **Commit only this track and deploy.** Separate from the in-flight Milestone 22 email changes in the same working tree (`schema.prisma` currently holds both). Manual deploy per `project_new_host_production` (git push does not auto-deploy): reset checkout, build, `migrate deploy`, `up -d`, verify the built image contains the change. | Claude | Blocked by 2, 4, 5 |
| 7 | **Import script (dry run first).** `apps/api/scripts/import-room-photos.ts` (`pnpm --filter api import:room-photos`). Runs through the same HTTP API the dashboard uses (login, library upload, confirm, attach), never the database or storage directly. Hash-deduplicates, maps folders via the table above, first photo in name order becomes the main image of a room with no photos, idempotent (skips library files with the same name and photos already attached), `--exclude <file>` drops named loose photos. **Dry run done 2026-10-01:** 71 unique folder photos across 13 room types, 181 loose photos for the library, all 14 live room types covered, no problems. The real run needs `IMPORT_EMAIL` / `IMPORT_PASSWORD` of an owner/admin and is run by the owner (credentials are never given to Claude). | Claude | Script + dry run done; real run blocked by 2, 6 |
| 8 | **Import run + loose photos.** Real run for the 71 unique folder photos; the 181 loose photos go to the library only (unassigned). Owner can first skim `loose-photos-contact-sheet.html` (Desktop) and supply an exclude list. | Claude | Blocked by 7 |
| 9 | **Verify live.** Public catalog returns images for all 14 room types; WordPress booking widget renders them; owner spot-checks main images in the dashboard. | Claude + Owner | Blocked by 8 |

## Follow-ups (not blocking the import)

- **Image resizing/WebP variants** via Cloudflare Image Resizing or equivalent — originals up to 10 MB are served as-is today.
- **Alt text / captions** per photo (accessibility and SEO).
- **Retire the legacy mirror columns** `room_types.main_image_url` / `gallery_image_urls` once the public catalog reads `room_type_images` directly (two sources of truth today).
- **Host hardening:** the new host runs everything as root and the automation SSH key has no passphrase (see Milestone 14 audit scope).
- **Email delivery** is tracked in Milestone 22, including re-sending the staff invitations for Iliamati022@gmail.com.

## Acceptance

- Every live room type with a source folder shows its photos and a main image on the public site.
- The library holds every imported photo exactly once; shared photos are not duplicated in storage.
- Migrations ran on a production-shaped copy first, and the deploy was verified from the built image.
- No Milestone 22 changes were committed as part of this track.
