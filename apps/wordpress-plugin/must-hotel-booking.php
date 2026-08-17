<?php
/**
 * Plugin Name: MUST Hotel Booking
 * Description: Guest-facing booking widget for MUST Booking. Talks only to the MUST API — no local reservation, payment, or PMS data is stored in WordPress.
 * Version: 0.1.2
 * Author: MUST
 * Author URI: https://must.al/
 * Requires at least: 5.0
 * Requires PHP: 7.4
 * Text Domain: must-hotel-booking
 * Update URI: https://must-hotel-booking.invalid/plugin-update-source
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

if (!\defined('ABSPATH')) {
    exit;
}

\define('MUST_HOTEL_BOOKING_VERSION', '0.1.2');
\define('MUST_HOTEL_BOOKING_FILE', __FILE__);
\define('MUST_HOTEL_BOOKING_PATH', \plugin_dir_path(__FILE__));
\define('MUST_HOTEL_BOOKING_URL', \plugin_dir_url(__FILE__));
\define('MUST_HOTEL_BOOKING_BASENAME', \plugin_basename(__FILE__));

if (!\defined('MUST_HOTEL_BOOKING_PLUGIN_SLUG')) {
    \define('MUST_HOTEL_BOOKING_PLUGIN_SLUG', 'must-hotel-booking');
}

if (!\defined('MUST_HOTEL_BOOKING_UPDATER_ENABLED')) {
    \define('MUST_HOTEL_BOOKING_UPDATER_ENABLED', true);
}

if (!\defined('MUST_HOTEL_BOOKING_GITHUB_REPOSITORY')) {
    // Override in wp-config.php if your production update source changes.
    \define('MUST_HOTEL_BOOKING_GITHUB_REPOSITORY', 'https://github.com/MUST-DEV-TEAM/must-hotel-booking');
}

if (!\defined('MUST_HOTEL_BOOKING_GITHUB_BRANCH')) {
    // Release tags should be created from this branch.
    \define('MUST_HOTEL_BOOKING_GITHUB_BRANCH', 'main');
}

if (!\defined('MUST_HOTEL_BOOKING_GITHUB_RELEASE_ASSET_PATTERN')) {
    // Match only the canonical release asset attached to GitHub releases.
    \define('MUST_HOTEL_BOOKING_GITHUB_RELEASE_ASSET_PATTERN', '/^must-hotel-booking-[0-9]+\\.[0-9]+\\.[0-9]+\\.zip$/i');
}

if (!\defined('MUST_HOTEL_BOOKING_GITHUB_TOKEN')) {
    // Define this in wp-config.php when using private repositories or releases.
    \define('MUST_HOTEL_BOOKING_GITHUB_TOKEN', '');
}

if (!\defined('MUST_HOTEL_BOOKING_PLATFORM_URL')) {
    // Where a pairing code is redeemed before this site has its own must_api_base_url
    // saved yet. Override in wp-config.php for local development.
    \define('MUST_HOTEL_BOOKING_PLATFORM_URL', 'https://must.dejvis.dev/api');
}

require_once MUST_HOTEL_BOOKING_PATH . 'includes/autoloader.php';
require_once MUST_HOTEL_BOOKING_PATH . 'includes/asset-url.php';
require_once MUST_HOTEL_BOOKING_PATH . 'includes/config.php';

\MustHotelBooking\Core\Updater::boot();
\MustHotelBooking\Core\BookingPerformanceMonitor::bootstrap();

\register_activation_hook(MUST_HOTEL_BOOKING_FILE, [\MustHotelBooking\Core\Plugin::class, 'activate']);
\register_deactivation_hook(MUST_HOTEL_BOOKING_FILE, [\MustHotelBooking\Core\Plugin::class, 'deactivate']);
\add_action('plugins_loaded', [\MustHotelBooking\Core\Plugin::class, 'maybeUpgradeDatabase'], 5);
\add_action('plugins_loaded', [\MustHotelBooking\Core\Plugin::class, 'initPlugin']);
