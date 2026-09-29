# MUST WordPress guest frontend

This directory contains the retrofitted guest-facing WordPress plugin for MUST Booking Platform. PHP templates, guest JavaScript and Elementor widgets call the platform through the server-side MustApiClient. Tenant staff operations live in the Next.js app.

Start at [platform documentation](../../docs/README.md), then [frontends and API](../../docs/architecture/frontends-and-api.md). The predecessor plugin documentation is preserved in the [historical archive](../../docs/archive/wordpress-plugin-pre-retrofit/README.md); it describes the standalone plugin before the platform retrofit.

## Setup and distribution

Install the runtime plugin ZIP into WordPress, activate it and connect it with the property pairing code from MUST's dashboard. Configuration stores the public API URL, tenant and property identifiers; no persistent plugin API credential is issued. See the bootstrap/readme distribution metadata for version and minimum requirements; compatibility must be tested on the actual WordPress/PHP runtime.

Activation/upgrades still invoke the legacy table installer. The guest flow uses the platform's booking authority, but the plugin is not literally free of local tables or legacy repositories. Preserve existing data and inspect bootstrap/hooks/upgrades before removing residual code.

The [release workflow](../../.github/workflows/wordpress-plugin-release.yml) packages this source on a version bump, publishes a release and supports WordPress-native update discovery via Core/Updater. No release or site update was performed during documentation initialization.

## Development

Use [plugin agent instructions](AGENTS.md) and [operations/testing](../../docs/operations/README.md). PHP/JS tests under tests/ vary between behavior checks and source assertions; inspect them before running. Provider calls, bookings/payments/refunds and production upgrades require explicit task authorization.
