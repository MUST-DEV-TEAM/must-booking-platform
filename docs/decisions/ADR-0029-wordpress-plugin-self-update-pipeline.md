# ADR-0029: WordPress plugin distributes via a self-update pipeline, not per-site SSH sync

Status: Accepted
Date: 2026-08-17

## Context

`apps/wordpress-plugin` is retrofitted into this monorepo (ADR-0016) and is the only guest-facing frontend for every tenant's WordPress site. Today it has two competing, and equally broken, paths to actually reach a live site:

1. **The documented path**: `apps/wordpress-plugin/tools/release-plugin.ps1` bumps the version, tags, and publishes a GitHub Release on a separate repo, `MUST-DEV-TEAM/must-hotel-booking` (the plugin's pre-monorepo home). That repo's last commit is 2026-07-18 and last release is `v0.4.90` (2026-07-12) — abandoned since the monorepo retrofit, despite Milestone 6 doing five more weeks of real live development against it after that date.
2. **The actual path**: someone with SSH access manually syncs `apps/wordpress-plugin`'s working tree onto the live host's plugin directory by hand. Confirmed directly against Empire Beach Resort's real host (`empire-live`, a Bitnami EC2 instance) during Milestone 12 Task 4's live trial: the deployed `must-hotel-booking.php` still declares version `0.1.2`, and file mtimes on the host trail this repo's `main` by however long it's been since the last manual sync — in this case, three real, merged, tested fixes (Tasks 21-23) sat live-unreachable for hours before being noticed, purely because pushing to `main` looks like a deploy but isn't one for this one directory in the repo.

Neither path is repeatable, and neither scales past the single site (Empire Beach Resort) it happens to have been exercised against so far. The monorepo is explicitly heading toward multiple tenants, each running their own independent WordPress install on hosting the platform team may not control or have SSH access to at all (managed/shared WP hosting is common and often has no shell access). A deploy mechanism that requires the deployer to hold SSH credentials for every tenant's host does not survive that future.

## Decision

Retire per-site SSH sync as the deploy mechanism. Replace it with the standard self-hosted-WordPress-plugin pattern: each site's own WordPress installation checks for and applies its own updates, the same way it already does for WP.org-hosted plugins — just pointed at a release channel this project controls instead of the WordPress.org directory.

1. **Release channel**: keep `MUST-DEV-TEAM/must-hotel-booking` as a repo, but repurpose its role — it is no longer a second copy of the source to keep in sync by hand. It becomes a pure release/distribution target: CI pushes a built ZIP and a version tag there; nothing is ever committed to its `main` by a person again. `apps/wordpress-plugin` in this monorepo remains the single source of truth for the code.
2. **CI packaging**: a GitHub Actions workflow in this monorepo, triggered on a version bump to `apps/wordpress-plugin/must-hotel-booking.php` landing on `main`, builds a ZIP from exactly the runtime files (`admin/`, `assets/`, `database/`, `frontend/`, `includes/`, `lib/`, `src/`, `index.php`, `must-hotel-booking.php`, `readme.txt`, `uninstall.php` — excluding `docs/`, `tests/`, `tools/`, `CHANGELOG.md`, `AUDIT.md`, and anything else dev-only) and publishes it as a GitHub Release on `must-hotel-booking` via a stored deploy token. This replaces `release-plugin.ps1` entirely; the script is deleted once the workflow is proven.
3. **In-plugin update checker**: vendor `YahnisElsts/plugin-update-checker` (MIT, the de facto standard for this exact problem, no Composer required — it ships as a plain PHP library) into `apps/wordpress-plugin/lib/`, and wire it into `must-hotel-booking.php`'s bootstrap pointed at `must-hotel-booking`'s GitHub Releases. Every connected site then sees real WordPress-native update notifications ("Update available") in its own `wp-admin` and can update itself — no SSH, no one on this team needing to know what hosting a given tenant chose.
4. **One-time bootstrap per already-live site**: getting the update checker itself onto a site that predates it still requires exactly one manual sync (this is unavoidable — a site can't self-update using a mechanism it doesn't have yet). After that, it never needs another manual sync.
5. **Docs**: `apps/wordpress-plugin/docs/OPERATIONS.md`'s "Deployment and release" section is rewritten to describe this flow; the current section describing `release-plugin.ps1` is removed, not left alongside it as a second/legacy option.

## Consequences

- **New CI surface**: a packaging/release workflow in this monorepo, and a deploy token scoped to `must-hotel-booking` stored as a repo secret.
- **New plugin dependency**: `plugin-update-checker`, vendored (not Composer-managed, to match the plugin's existing no-build-step convention).
- **One remaining manual step, forever, but only once per site**: initial onboarding of a brand-new tenant's WordPress install still needs the plugin (with the update checker already inside it) installed once, the normal way any WP plugin is installed (upload the ZIP, or a future one-click installer) — this ADR doesn't change first-install, only every update after it.
- **`tools/release-plugin.ps1` is deleted**, not deprecated-in-place, once the CI workflow is verified working — keeping both invites exactly the "which one is real" confusion this ADR exists to end.
- **Versioning stays in `must-hotel-booking.php`'s `Version:` header** (unchanged mechanism) — CI reads it rather than a human running a script that edits it.

## Alternatives considered

- **Fix `release-plugin.ps1` and actually run it going forward**: smaller change, but still requires a human to remember to run a manual script after every plugin change, on every machine that has `gh` configured for that repo — the exact discipline that already failed silently for five weeks. Rejected: the goal is removing the manual step, not re-committing to it more carefully.
- **Central CI push to every tenant's host via SSH** (a config-driven list of deploy targets): works only for hosts the platform team controls. Rejected outright once the "hosting the tenant may choose, not us" future is taken seriously — this is the same failure mode as today's manual sync, just automated.
- **Composer-manage the update-checker dependency**: more conventional for modern PHP, but introduces a build step (`composer install`) into a plugin that has never had one and is deployed as a flat directory of PHP files. Rejected for now as unnecessary complexity; revisit if the plugin ever gains other Composer-worthy dependencies.
