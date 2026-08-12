<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

define('MUST_HOTEL_BOOKING_URL', 'https://example.test/plugin/');
define('MUST_HOTEL_BOOKING_VERSION', '1.2.3');

require_once dirname(__DIR__) . '/includes/asset-url.php';

$url = must_hotel_booking_asset_url('/assets/img/bed.svg');
if ($url !== 'https://example.test/plugin/assets/img/bed.svg?ver=1.2.3') {
    fwrite(STDERR, "Asset URLs must include the plugin version.\n");
    exit(1);
}

echo "Asset URL versioning tests passed.\n";
