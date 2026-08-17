<?php

namespace MustHotelBooking\Core;

final class Plugin
{
    public static function activate(): void
    {
        \MustHotelBooking\Database\install_tables();
        \MustHotelBooking\Core\MustBookingConfig::remove_legacy_payment_configuration();
        \MustHotelBooking\Core\MustBookingConfig::remove_legacy_clock_configuration();
        \MustHotelBooking\Core\ManagedPages::install();

        \flush_rewrite_rules();
    }

    public static function deactivate(): void
    {
        \flush_rewrite_rules();
    }

    public static function maybeUpgradeDatabase(): void
    {
        \MustHotelBooking\Core\MustBookingConfig::remove_legacy_payment_configuration();
        \MustHotelBooking\Core\MustBookingConfig::remove_legacy_clock_configuration();
        $db_version = (string) \get_option('must_hotel_booking_db_version', '0.0.0');

        if (\version_compare($db_version, MUST_HOTEL_BOOKING_VERSION, '>=')) {
            \MustHotelBooking\Database\ensure_public_access_schema();
            \MustHotelBooking\Database\ensure_confirmation_integrity_schema();
            return;
        }

        \MustHotelBooking\Database\install_tables();
    }

    public static function initPlugin(): void
    {
        \MustHotelBooking\Core\MustBookingConfig::remove_legacy_payment_configuration();
        \MustHotelBooking\Core\MustBookingConfig::remove_legacy_clock_configuration();
        // Deferred to `init`: creating a genuinely new managed page calls
        // wp_insert_post(), which needs get_permalink() -> $wp_rewrite -
        // not yet instantiated this early on `plugins_loaded`. Repairing an
        // already-existing page's assignment doesn't hit that path, which is
        // why this only ever surfaced once a brand-new page config was added.
        \add_action('init', [\MustHotelBooking\Core\ManagedPages::class, 'sync']);
        \MustHotelBooking\Core\PluginSupportWidget::registerHooks();
        \MustHotelBooking\Core\ActivityLogger::registerHooks();
        \MustHotelBooking\Core\PublicCallbackUrl::registerHooks();

        \MustHotelBooking\Engine\EmailEngine::registerHooks();

        \do_action('must_hotel_booking/init');
    }
}
