# MUST Hotel Booking

MUST Hotel Booking is a WordPress hotel-booking and operations plugin. It manages accommodations, availability, pricing, guest reservations, payments, refunds, staff workflows, email notifications, and optional Clock PMS synchronization from one plugin.

## Project status

- Current working-tree release candidate: `0.4.92`, based on commit `b0380ad`.
- Runtime: WordPress plugin; metadata declares PHP 7.4+ and active payment, email, portal, and quote paths use PHP 7.4-compatible helpers.
- Status: active development with substantial local, Stripe, PokPay, Clock PMS, admin, staff-portal, and Elementor functionality.
- Readiness: **code-hardened, not production-certified**. Local checks pass, but real WordPress/database upgrades, Clock account rights and response shapes, callbacks, cron, and payment/refund E2E still require approved environment acceptance. See [Project Context](docs/PROJECT_CONTEXT.md) and [Operations](docs/OPERATIONS.md).

## Main capabilities

- Managed public booking, accommodation selection, checkout, confirmation, and guest cancellation flows.
- Local and Clock-backed availability, quoting, reservation, synchronization, and amendment workflows.
- Stripe Checkout, PokPay SDK checkout, opt-in Pay at Hotel, refunds, and Clock deposit-folio accounting.
- WordPress admin workspaces for reservations, payments, rooms, pricing, availability, guests, email, reports, settings, and diagnostics.
- Capability-gated staff portal at `/staff` with login at `/staff-login`.
- Elementor booking search, room list, and room text-grid widgets.
- GitHub release updater and release-package workflow.

## Requirements

- WordPress 5.0 or later.
- PHP 7.4 or later; test the exact deployment runtime before release.
- Pretty permalinks for staff portal routes.
- Provider credentials and callback URLs only when the relevant integration is explicitly enabled.

The header/readme requirements are distribution metadata, not runtime certification. Treat the exact PHP runtime and WordPress versions newer than the recorded tested-through value as unverified until deployment compatibility tests pass.

## Local installation

1. Place this directory at `wp-content/plugins/must-hotel-booking`, or install a canonical release ZIP.
2. Activate **MUST Hotel Booking** in WordPress.
3. Open **MUST Hotel Booking → Settings** and review hotel identity, booking rules, managed pages, payments, email, staff access, and provider mode.
4. Save permalinks if `/staff` or managed-page routing returns 404.
5. Test the full booking lifecycle in a non-production environment before enabling public traffic.

Activation installs or upgrades plugin tables, creates managed pages, synchronizes staff capabilities, schedules WP-Cron hooks, and flushes rewrite rules. Do not activate against an unsnapshotted production database as an informal test.

## Safe development checks

Run from the plugin root:

```powershell
git status --short
php -l path\to\changed-file.php
php tests\PaymentPublicCheckoutPolicyTest.php
php tests\ProviderDataSanitizerTest.php
git diff --check
```

The standalone tests vary in strength; some inspect source markers and do not prove concurrency or database behavior. The WordPress-loaded E2E harness and provider preflight tools have different side-effect boundaries. Read [Operations](docs/OPERATIONS.md) before running them.

## Documentation

- Start with the task router: [docs/INDEX.md](docs/INDEX.md).
- Current architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Booking and payment behavior: [docs/DOMAIN_LIFECYCLES.md](docs/DOMAIN_LIFECYCLES.md).
- Installation, diagnostics, deployment, and recovery: [docs/OPERATIONS.md](docs/OPERATIONS.md).
- Notable changes: [CHANGELOG.md](CHANGELOG.md).

## Production and provider warning

Do not run provider probes, callback tests, Clock sync, booking/payment/refund E2E, cleanup scripts, deployment, or production-data operations without explicit approval, a verified non-production target where applicable, and a current backup. Browser return data is not authoritative payment proof.

## License

GPL-2.0-or-later. See the plugin header and `readme.txt`.
