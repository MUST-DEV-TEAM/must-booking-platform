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
        \MustHotelBooking\Core\ManagedPages::sync();
        \MustHotelBooking\Core\Updater::boot();
        \MustHotelBooking\Core\PluginSupportWidget::registerHooks();
        \MustHotelBooking\Core\ActivityLogger::registerHooks();
        \MustHotelBooking\Core\PublicCallbackUrl::registerHooks();

        \MustHotelBooking\Engine\EmailEngine::registerHooks();

        \do_action('must_hotel_booking/init');
    }
}
