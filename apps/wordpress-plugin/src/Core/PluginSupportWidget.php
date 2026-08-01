<?php

namespace MustHotelBooking\Core;


final class PluginSupportWidget
{
    private const HUBSPOT_SCRIPT_ID = 'hs-script-loader';
    private const HUBSPOT_SCRIPT_SRC = 'https://js-eu1.hs-scripts.com/26865082.js';

    private static bool $shouldPrint = false;
    private static bool $printed = false;

    public static function registerHooks(): void
    {
        \add_action('admin_enqueue_scripts', [self::class, 'maybeQueueAdminWidget']);
        \add_action('admin_footer', [self::class, 'printWidgetLoader']);
        \add_action('wp_footer', [self::class, 'printWidgetLoader']);
    }

    public static function maybeQueueAdminWidget(): void
    {
        if (!\is_admin()) {
            return;
        }

        if (!\is_user_logged_in()) {
            return;
        }

        $page = isset($_GET['page']) && !\is_array($_GET['page'])
            ? \sanitize_key((string) \wp_unslash($_GET['page']))
            : '';

        if ($page === '') {
            return;
        }

        if (
            $page === 'must-hotel-booking'
            || \strpos($page, 'must-hotel-booking-') === 0
            || \strpos($page, 'must_hotel_booking_') === 0
        ) {
            self::$shouldPrint = true;
        }
    }

    public static function printWidgetLoader(): void
    {
        if (!self::$shouldPrint || self::$printed) {
            return;
        }

        self::$printed = true;
        ?>
        <!-- Start of MUST Plugin Support HubSpot Embed Code -->
        <script type="text/javascript">
            window.addEventListener('load', function () {
                if (document.getElementById('hs-script-loader')) {
                    return;
                }

                var hsScript = document.createElement('script');
                hsScript.type = 'text/javascript';
                hsScript.id = 'hs-script-loader';
                hsScript.src = 'https://js-eu1.hs-scripts.com/26865082.js';
                hsScript.async = true;
                hsScript.defer = true;
                document.head.appendChild(hsScript);
            });
        </script>
        <!-- End of MUST Plugin Support HubSpot Embed Code -->
        <?php
    }
}
